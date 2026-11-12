import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createPublicKey } from 'node:crypto';
import express from 'express';
import { createApplication } from './app.js';

const port = Number(process.env.PORT ?? 4317);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('PORT 1024–65535 aralığında olmalı.');
const production = process.argv.includes('--production');
const publicKey = process.env.LICENSE_PUBLIC_KEY_FILE
  ? readFileSync(resolve(process.env.LICENSE_PUBLIC_KEY_FILE), 'utf8')
  : undefined;
if (publicKey && createPublicKey(publicKey).asymmetricKeyType !== 'ed25519')
  throw new Error('Lisans için Ed25519 açık anahtarı gerekli.');
const runtime = createApplication({
  databasePath: resolve(process.env.DATA_DIR ?? './data-local', 'quizcast.sqlite'),
  apiKey: process.env.EULER_API_KEY,
  publicKey,
  ownerOverride: process.env.ALLOW_UNLICENSED_LIVE === 'true',
  demoAuto: process.env.DEMO_AUTO !== 'false',
});
const server = createServer(runtime.app);
let closeVite: (() => Promise<void>) | undefined;
if (production) {
  runtime.app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'self'",
    );
    next();
  });
  runtime.app.use(express.static(resolve('dist/client'), { index: false }));
  runtime.app.get(['/', '/overlay'], (_req, res) => res.sendFile(resolve('dist/client/index.html')));
} else {
  const { createServer: createViteServer } = await import('vite');
  const vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: { server },
      fs: {
        deny: [
          '.env',
          '.env.*',
          '**/.git/**',
          '**/data-local/**',
          '**/private-keys/**',
          '**/*.pem',
          '**/*.sqlite*',
          '**/*.license.json',
        ],
      },
    },
  });
  runtime.app.use(vite.middlewares);
  closeVite = () => vite.close();
}
server.on('error', (error) => {
  console.error(
    error instanceof Error && 'code' in error && error.code === 'EADDRINUSE'
      ? `Port ${port} kullanımda. .env içindeki PORT değerini değiştir.`
      : 'Yerel sunucu başlatılamadı.',
  );
  runtime.close();
  process.exit(1);
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    `QuizCast Studio: http://localhost:${port}\nYalnızca bu bilgisayardan erişilebilir. İlk açılışta yönetici şifreni oluştur.`,
  ),
);
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  runtime.close();
  await closeVite?.();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
