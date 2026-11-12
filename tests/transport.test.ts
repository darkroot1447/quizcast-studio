import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import WebSocket, { WebSocketServer } from 'ws';
import { QuizEngine } from '../server/engine.js';
import { LiveSource } from '../server/source.js';
import { defaultSettings } from '../shared/schema.js';
import { seedQuestions } from '../data/questions.js';

async function waitFor(condition: () => boolean) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Expected local WebSocket event was not received.');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
test('local WebSocket transport consumes chat and pauses on terminal provider closure', async (t) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const engine = new QuizEngine({ ...defaultSettings, shuffleOptions: false }, () => {});
  const source = new LiveSource(
    engine,
    'synthetic-placeholder',
    () => true,
    (url) => {
      assert.equal(url.searchParams.get('features.rawMessages'), 'false');
      assert.equal(url.searchParams.get('uniqueId'), 'test_channel');
      return new WebSocket(`ws://127.0.0.1:${address.port}`);
    },
  );
  t.after(async () => {
    source.cleanup();
    for (const client of server.clients) client.terminate();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const peerPromise = once(server, 'connection');
  source.connect('test_channel');
  const [peer] = (await peerPromise) as [WebSocket];
  assert.equal(engine.connection.status, 'connecting');
  peer.send(JSON.stringify({ type: 'tiktok.connect', data: { agentId: 'test' } }));
  await waitFor(() => engine.connection.status === 'connected');
  engine.start([seedQuestions[0]]);
  peer.send(
    JSON.stringify({
      messages: [
        {
          type: 'WebcastChatMessage',
          data: {
            common: { msgId: 'local-1' },
            user: { userId: 'u1', nickname: 'Yerel test' },
            content: 'A',
          },
        },
      ],
    }),
  );
  await waitFor(() => engine.snapshot().answers === 1);
  peer.close(4401, 'Do not forward private provider errors');
  await waitFor(() => engine.connection.status === 'error');
  assert.equal(engine.paused, true);
  assert.equal(engine.connection.message, 'API anahtarı geçersiz.');
  assert.equal(engine.connection.retries, 0);
});
