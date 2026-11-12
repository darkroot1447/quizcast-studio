import express, { type Request, type Response, type NextFunction } from 'express';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { questionSchema, settingsSchema } from '../shared/schema.js';
import { Store } from './store.js';
import { QuizEngine } from './engine.js';
import { LicenseManager } from './license.js';
import { LiveSource } from './source.js';

const cookie = (req: Request) =>
  req.headers.cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('qc_session='))
    ?.slice(11) ?? '';
const equal = (a: string, b: string) =>
  /^[a-f0-9]{64}$/.test(a) && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function csvCell(value: string | number) {
  const string = String(value);
  const safe = /^[\s]*[=+@\-\t\r]/.test(string) ? `'${string}` : string;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function createApplication(options: {
  databasePath: string;
  apiKey?: string;
  publicKey?: string;
  ownerOverride?: boolean;
  demoAuto?: boolean;
}) {
  const store = new Store(options.databasePath);
  const engine = new QuizEngine(store.settings, (record) => store.saveResult(record));
  const licensing = new LicenseManager(store, options.publicKey, options.ownerOverride);
  const source = new LiveSource(engine, options.apiKey, () => licensing.info().liveAllowed);
  source.useDemo();
  source.setDemoEnabled(options.demoAuto ?? true);
  const app = express();
  app.disable('x-powered-by');
  const clients = new Set<Response>();
  const attempts = new Map<string, { count: number; until: number }>();

  app.use((req, res, next) => {
    const host = req.headers.host ?? '';
    if (!/^(localhost|127\.0\.0\.1)(:\d{1,5})?$/.test(host)) {
      res.status(403).json({ error: 'Yalnızca yerel bağlantıya izin verilir.' });
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== `http://${host}`) {
      res.status(403).json({ error: 'İstek kaynağı doğrulanamadı. Paneli aynı yerel adresten aç.' });
      return;
    }
    next();
  });
  app.use('/api', express.json({ limit: '1mb' }));
  const authenticated = (req: Request) => store.hasSession(cookie(req));
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    if (!authenticated(req)) {
      res.status(401).json({ error: 'Yönetici girişi gerekli.' });
      return;
    }
    next();
  };
  const overlayAccess = (req: Request) =>
    typeof req.query.token === 'string' && equal(req.query.token, store.get<string>('overlayToken')!);
  const sessionCookie = (res: Response, token: string) =>
    res.cookie('qc_session', token, {
      httpOnly: true,
      sameSite: 'strict',
      maxAge: 12 * 60 * 60 * 1000,
      path: '/',
    });
  const requireStopped = () => {
    if (engine.active) throw new Error('Bu işlem için önce yarışmayı bitir.');
  };
  const state = () => ({
    snapshot: engine.snapshot(),
    settings: store.settings,
    questions: store.questions(),
    history: store.history(),
    overlayToken: store.get('overlayToken'),
    license: licensing.info(),
    providerConfigured: source.configured,
  });

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/bootstrap', (req, res) =>
    res.json({ setupRequired: !store.get('password'), authenticated: authenticated(req) }),
  );
  app.post(['/api/setup', '/api/login'], (req, res) => {
    const key = req.socket.remoteAddress ?? 'local';
    const now = Date.now();
    const attempt = attempts.get(key);
    if (attempt && attempt.until > now && attempt.count >= 8) {
      res.status(429).json({ error: 'Çok fazla deneme. 15 dakika sonra tekrar dene.' });
      return;
    }
    const counter = attempt && attempt.until > now ? attempt : { count: 0, until: now + 15 * 60_000 };
    counter.count++;
    attempts.set(key, counter);
    const { password } = z
      .object({ password: z.string().min(12, 'Şifre en az 12 karakter olmalı.').max(128) })
      .strict()
      .parse(req.body);
    if (req.path === '/api/setup') store.setup(password);
    else if (!store.authenticate(password)) {
      res.status(401).json({ error: 'Şifre hatalı.' });
      return;
    }
    attempts.delete(key);
    sessionCookie(res, store.createSession());
    res.json({ ok: true });
  });
  app.post('/api/logout', requireAuth, (req, res) => {
    store.removeSession(cookie(req));
    res.clearCookie('qc_session', { path: '/' });
    res.json({ ok: true });
  });

  app.get('/api/overlay/state', (req, res) => {
    if (!overlayAccess(req)) {
      res.status(403).json({ error: 'Yayın ekranı bağlantısı geçersiz. Panelden yeni bağlantıyı kopyala.' });
      return;
    }
    res.json(engine.snapshot());
  });
  app.get('/api/events', (req, res) => {
    if (!authenticated(req) && !overlayAccess(req)) {
      res.status(401).end();
      return;
    }
    if (clients.size >= 20) {
      res.status(429).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`data: ${JSON.stringify(engine.snapshot())}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  });
  app.use('/api/admin', requireAuth);
  app.get('/api/admin/state', (_req, res) => res.json(state()));
  app.post('/api/admin/game/:action', (req, res) => {
    switch (req.params.action) {
      case 'start':
        if (engine.connection.mode === 'tiktok' && !licensing.info().liveAllowed)
          throw new Error('Canlı yarışma için geçerli lisans gerekli.');
        engine.start(store.questions());
        break;
      case 'pause':
        engine.pause();
        break;
      case 'resume':
        engine.resume();
        break;
      case 'next':
        engine.advance();
        break;
      case 'stop':
        engine.stop();
        break;
      default:
        res.status(404).json({ error: 'Komut bulunamadı.' });
        return;
    }
    res.json(engine.snapshot());
  });
  app.put('/api/admin/settings', (req, res) => {
    const settings = settingsSchema.parse(req.body);
    requireStopped();
    store.set('settings', settings);
    engine.updateSettings(settings);
    res.json(settings);
  });
  app.post('/api/admin/source', (req, res) => {
    const { mode } = z
      .object({ mode: z.enum(['demo', 'tiktok', 'disconnect']) })
      .strict()
      .parse(req.body);
    if (mode === 'demo') source.useDemo();
    else if (mode === 'tiktok') source.connect(store.settings.channel);
    else {
      if (engine.connection.mode !== 'tiktok')
        throw new Error('Demo modunda kesilecek bir TikTok bağlantısı yok.');
      source.disconnect();
    }
    res.json(engine.snapshot().connection);
  });
  app.post('/api/admin/demo', (req, res) => {
    if (engine.connection.mode !== 'demo')
      throw new Error('Test cevapları yalnızca demo modunda gönderilebilir.');
    const input = z
      .object({
        name: z.string().trim().min(1).max(40),
        answer: z.enum(['A', 'B', 'C', 'D', '1', '2', '3', '4']),
      })
      .strict()
      .parse(req.body);
    const accepted = engine.chat(
      randomUUID(),
      `manual:${input.name.toLocaleLowerCase('tr')}`,
      input.name,
      input.answer,
    );
    res.json({
      accepted,
      message: accepted
        ? 'Cevap alındı.'
        : 'Cevap alınamadı: süreyi, duraklatmayı ve tekrar cevabı kontrol et.',
    });
  });
  app.post('/api/admin/questions', (req, res) => {
    requireStopped();
    const q = questionSchema.parse({ ...req.body, id: randomUUID() });
    store.saveQuestion(q);
    res.status(201).json(q);
  });
  app.put('/api/admin/questions/:id', (req, res) => {
    requireStopped();
    const q = questionSchema.parse({ ...req.body, id: req.params.id });
    store.saveQuestion(q, true);
    res.json(q);
  });
  app.delete('/api/admin/questions/:id', (req, res) => {
    requireStopped();
    if (!store.deleteQuestion(String(req.params.id))) {
      res.status(404).json({ error: 'Soru bulunamadı.' });
      return;
    }
    res.json({ ok: true });
  });
  app.post('/api/admin/questions/import', (req, res) => {
    requireStopped();
    const rows = z.array(questionSchema).min(1).max(500).parse(req.body);
    res.json(store.importQuestions(rows));
  });
  app.get('/api/admin/questions/export', (_req, res) =>
    res
      .attachment('quizcast-sorular.json')
      .type('json')
      .send(JSON.stringify(store.questions(), null, 2)),
  );
  app.get('/api/admin/results/export', (_req, res) => {
    const rows = [
      ['Sıra', 'İzleyici', 'Puan', 'Doğru', 'Cevaplanan'],
      ...engine.rankings().map((p, i) => [i + 1, p.name, p.score, p.correct, p.answered]),
    ];
    res
      .attachment('quizcast-siralama.csv')
      .type('text/csv')
      .send('\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
  });
  app.post('/api/admin/license', (req, res) => res.json(licensing.activate(req.body)));
  app.post('/api/admin/overlay/rotate', (_req, res) => {
    store.set('overlayToken', randomBytes(32).toString('hex'));
    for (const client of clients) client.end();
    clients.clear();
    res.json({ token: store.get('overlayToken') });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API yolu bulunamadı.' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' · ') });
      return;
    }
    const message = error instanceof Error ? error.message : 'İşlem tamamlanamadı.';
    if (message.includes('UNIQUE constraint')) {
      res.status(409).json({ error: 'Aynı soru zaten havuzda bulunuyor.' });
      return;
    }
    if (message.includes('JSON') || message.includes('entity')) {
      res.status(400).json({ error: 'Geçersiz veya fazla büyük JSON verisi.' });
      return;
    }
    res.status(400).json({ error: message });
  });

  const timer = setInterval(() => {
    engine.tick();
    if (!clients.size) return;
    const payload = `data: ${JSON.stringify(engine.snapshot())}\n\n`;
    for (const client of clients) {
      if (client.writableLength > 1024 * 1024) {
        client.end();
        clients.delete(client);
      } else client.write(payload);
    }
  }, 250);
  timer.unref();
  return {
    app,
    store,
    engine,
    source,
    licensing,
    close: () => {
      clearInterval(timer);
      source.cleanup();
      engine.stop();
      for (const client of clients) client.end();
      store.close();
    },
  };
}
