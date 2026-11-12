import WebSocket from 'ws';
import { randomUUID } from 'node:crypto';
import type { ConnectionState } from '../shared/schema.js';
import type { QuizEngine } from './engine.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as ObjectValue) : {};
const text = (value: unknown) =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : '';
const number = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);

const roomStates: Record<number, string> = {
  1: 'connecting',
  2: 'connected',
  3: 'reconnecting',
  4: 'offline',
  5: 'ended',
  6: 'error',
};

type NormalizedProviderEvent =
  | { kind: 'status'; state: string; code?: number }
  | { kind: 'connect' }
  | { kind: 'disconnect'; code?: number }
  | { kind: 'data'; type: string; data: ObjectValue };

function normalizedProviderEvents(frame: unknown): NormalizedProviderEvent[] {
  const root = object(frame);
  const rawEvents = Array.isArray(root.messages) ? root.messages : Array.isArray(frame) ? frame : [frame];
  const normalized: NormalizedProviderEvent[] = [];
  for (const raw of rawEvents.slice(0, 2000)) {
    const event = object(raw);
    const roomStatus = object(event.roomStatusEvent);
    if (Object.keys(roomStatus).length) {
      const rawState = roomStatus.state;
      normalized.push({
        kind: 'status',
        state: typeof rawState === 'string' ? rawState : (roomStates[number(rawState)] ?? 'error'),
        code: number(roomStatus.closeCode) || undefined,
      });
      continue;
    }
    if (event.connectEvent) {
      normalized.push({ kind: 'connect' });
      continue;
    }
    if (event.disconnectEvent) {
      normalized.push({
        kind: 'disconnect',
        code: number(object(event.disconnectEvent).closeCode) || undefined,
      });
      continue;
    }
    const custom = object(event.customEvent);
    if (typeof custom.type === 'string') {
      try {
        normalized.push({ kind: 'data', type: custom.type, data: object(JSON.parse(text(custom.json))) });
      } catch {
        // Ignore malformed provider frames. They must never enter the scoring path.
      }
      continue;
    }
    const type = text(event.type);
    if (type) normalized.push({ kind: 'data', type, data: object(event.data) });
  }
  return normalized;
}

/** Normalizes documented JSON bundles. Unknown event types are deliberately ignored. */
export function consumeEulerFrame(
  frame: unknown,
  engine: QuizEngine,
  onStatus: (status: string, code?: number) => void,
) {
  for (const event of normalizedProviderEvents(frame)) {
    if (event.kind === 'status') {
      onStatus(event.state, event.code);
      continue;
    }
    if (event.kind === 'connect') {
      onStatus('connected');
      continue;
    }
    if (event.kind === 'disconnect') {
      onStatus('reconnecting', event.code);
      continue;
    }
    const data = event.data;
    const type = event.type;
    if (type === 'room.status') {
      onStatus(text(data.state), number(data.code));
      continue;
    }
    if (type === 'tiktok.connect') {
      onStatus('connected');
      continue;
    }
    if (type === 'tiktok.disconnect') {
      onStatus('reconnecting', number(data.reason));
      continue;
    }
    const common = object(data.common);
    const user = object(data.user);
    const userId = text(user.userId) || text(user.id) || text(user.uniqueId) || text(user.displayId);
    const name = text(user.nickname) || text(user.uniqueId) || text(user.displayId) || 'İzleyici';
    const id = text(common.msgId) || text(data.msgId);
    // No stable identity/message ID means no trustworthy scoring or deduplication.
    if (!id || !userId) continue;
    const created = number(common.createTime);
    if (created && Date.now() - (created < 1e12 ? created * 1000 : created) > 30_000) continue;
    if (type === 'WebcastChatMessage') engine.chat(`chat:${id}`, userId, name, text(data.content));
    if (type === 'WebcastLikeMessage') engine.engagement(`like:${id}`, 'like', name, number(data.count));
    if (type === 'WebcastSocialMessage' && number(data.action) === 1)
      engine.engagement(`follow:${id}`, 'follow', name);
    if (type === 'WebcastGiftMessage') {
      const gift = object(data.gift);
      const details = object(data.giftDetails);
      const giftType = number(gift.type ?? gift.giftType ?? details.giftType ?? data.giftType);
      if (giftType === 1 && data.repeatEnd !== true && number(data.repeatEnd) !== 1) continue;
      const group = text(data.groupId);
      const giftId = text(data.giftId) || text(gift.id);
      const dedupeId = group ? `gift:${userId}:${giftId}:${group}` : `gift:${id}`;
      engine.engagement(
        dedupeId,
        'gift',
        name,
        number(data.repeatCount) || 1,
        text(gift.name) || text(details.giftName) || text(data.giftName) || 'Hediye',
      );
    }
  }
}

const terminalMessages: Record<number, string> = {
  4005: 'TikTok yayını sona erdi.',
  4400: 'Sağlayıcı bağlantı ayarlarını kabul etmedi.',
  4401: 'API anahtarı geçersiz.',
  4403: 'Bu yayın için sağlayıcı erişim izni yok.',
  4404: 'Hesap şu anda canlı yayında değil.',
  4429: 'Sağlayıcı bağlantı veya hız limiti aşıldı.',
};

export class LiveSource {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private timeout?: ReturnType<typeof setTimeout>;
  private demo?: ReturnType<typeof setInterval>;
  private heartbeat?: ReturnType<typeof setInterval>;
  private generation = 0;
  private attempts = 0;
  private demoCount = 0;
  private demoEnabled = true;
  constructor(
    private engine: QuizEngine,
    private apiKey: string | undefined,
    private canConnect: () => boolean,
    private socketFactory = (url: URL) =>
      new WebSocket(url, { handshakeTimeout: 15000, maxPayload: 2 * 1024 * 1024 }),
  ) {}
  get configured() {
    return !!this.apiKey;
  }
  setDemoEnabled(enabled: boolean) {
    this.demoEnabled = enabled;
  }
  useDemo() {
    if (this.engine.active) throw new Error('Mod değiştirmeden önce yarışmayı bitir.');
    this.cleanup();
    this.engine.setConnection({
      mode: 'demo',
      status: 'connected',
      message: 'Simülasyon hazır. Veriler gerçek izleyicilere ait değil.',
      retries: 0,
    });
    const names = [
      'Deniz',
      'Ece',
      'Mert',
      'Zeynep',
      'Arda',
      'Selin',
      'Can',
      'Elif',
      'Bora',
      'Duru',
      'Eren',
      'İpek',
      'Ozan',
      'Sude',
      'Ali',
      'Aslı',
    ];
    this.demo = setInterval(() => {
      if (!this.demoEnabled || !this.engine.active || this.engine.paused) return;
      const index = Math.floor(Math.random() * names.length);
      const question = this.engine.currentQuestion;
      const answer = question && Math.random() < 0.6 ? question.answer : Math.floor(Math.random() * 4);
      this.engine.chat(randomUUID(), `demo-${index}`, `${names[index]} · demo`, 'ABCD'[answer]);
      this.engine.engagement(randomUUID(), 'like', names[index], 1 + Math.floor(Math.random() * 8));
      if (++this.demoCount % 12 === 0)
        this.engine.engagement(randomUUID(), 'gift', `${names[index]} · demo`, 1, 'Gül');
    }, 950);
    this.demo.unref();
  }
  connect(channel: string) {
    if (this.engine.active && this.engine.connection.mode !== 'tiktok')
      throw new Error('Mod değiştirmeden önce yarışmayı bitir.');
    if (!this.apiKey)
      throw new Error('Sunucuda EULER_API_KEY ayarlanmalı. Anahtarı sohbete veya tarayıcıya yazma.');
    if (!this.canConnect()) throw new Error('Canlı bağlantı için geçerli lisans gerekli.');
    if (!/^[a-zA-Z0-9_.]{2,24}$/.test(channel))
      throw new Error('Ayarlar bölümüne geçerli TikTok kullanıcı adını yaz.');
    this.cleanup();
    this.attempts = 0;
    const generation = this.generation;
    this.open(channel, generation);
  }
  private status(status: ConnectionState['status'], message: string) {
    this.engine.setConnection({ mode: 'tiktok', status, message, retries: this.attempts });
  }
  private open(channel: string, generation: number) {
    if (generation !== this.generation) return;
    if (!this.canConnect()) {
      this.status('error', 'Lisans doğrulanamadı.');
      return;
    }
    this.status(
      this.attempts ? 'reconnecting' : 'connecting',
      this.attempts ? 'Bağlantı yeniden deneniyor…' : 'TikTok yayınına bağlanılıyor…',
    );
    const url = new URL('wss://ws.eulerstream.com');
    for (const [key, value] of Object.entries({
      uniqueId: channel,
      apiKey: this.apiKey!,
      'features.rawMessages': 'false',
      'features.bundleEvents': 'true',
      'features.schemaVersion': 'v2',
    }))
      url.searchParams.set(key, value);
    const ws = (this.socket = this.socketFactory(url));
    let alive = true;
    this.timeout = setTimeout(() => {
      if (this.engine.connection.status !== 'connected') ws.terminate();
    }, 25000);
    ws.on('pong', () => {
      alive = true;
    });
    ws.on('open', () => {
      this.heartbeat = setInterval(() => {
        if (!this.canConnect()) {
          this.disconnect('Lisans süresi doldu; bağlantı kapatıldı.');
          return;
        }
        if (!alive) {
          ws.terminate();
          return;
        }
        alive = false;
        ws.ping();
      }, 30000);
    });
    ws.on('message', (raw) => {
      if (generation !== this.generation) return;
      try {
        consumeEulerFrame(JSON.parse(raw.toString()), this.engine, (state, code) => {
          if (state === 'connected') {
            clearTimeout(this.timeout);
            this.status('connected', `@${channel} yayını bağlı.`);
          } else if (state === 'connecting' || state === 'reconnecting')
            this.status(state, 'Sağlayıcı yayın bağlantısını kuruyor…');
          else if (['offline', 'ended', 'error'].includes(state))
            this.disconnect(terminalMessages[code ?? 0] ?? 'Yayın bağlantısı hazır değil.');
        });
      } catch {
        this.disconnect(
          'Sağlayıcıdan beklenen JSON biçimi alınamadı. Adaptör güncellemesi gerekli olabilir.',
        );
      }
    });
    // Do not log raw WebSocket errors: they can include a URL containing the API key.
    ws.on('error', () => {});
    ws.on('close', (code) => {
      clearTimeout(this.timeout);
      clearInterval(this.heartbeat);
      if (generation !== this.generation) return;
      if (terminalMessages[code] || this.attempts >= 5) {
        this.status(
          'error',
          terminalMessages[code] ?? '5 yeniden bağlantı denemesi başarısız. Elle tekrar bağlan.',
        );
        return;
      }
      const delay = Math.min(30000, 1000 * 2 ** this.attempts++) + Math.floor(Math.random() * 400);
      this.status(
        'reconnecting',
        `Bağlantı koptu. ${Math.ceil(delay / 1000)} saniye sonra yeniden denenecek.`,
      );
      this.retry = setTimeout(() => this.open(channel, generation), delay);
    });
  }
  disconnect(message = 'Bağlantı yayıncı tarafından kapatıldı.') {
    this.cleanup();
    this.status('offline', message);
  }
  cleanup() {
    this.generation++;
    clearTimeout(this.retry);
    clearTimeout(this.timeout);
    clearInterval(this.demo);
    clearInterval(this.heartbeat);
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.on('error', () => {});
      this.socket.terminate();
      this.socket = undefined;
    }
  }
}
