import test from 'node:test';
import assert from 'node:assert/strict';
import { QuizEngine } from '../server/engine.js';
import { consumeEulerFrame, LiveSource } from '../server/source.js';
import { defaultSettings } from '../shared/schema.js';
import { seedQuestions } from '../data/questions.js';

const setup = () => {
  const engine = new QuizEngine({ ...defaultSettings, shuffleOptions: false }, () => {});
  engine.start([seedQuestions[0]]);
  return engine;
};
// Synthetic fixtures matching the provider's documented JSON contract, not captured live traffic.
test('provider chat bundles normalize IDs and deduplicate messages', () => {
  const engine = setup();
  const frame = {
    messages: [
      {
        type: 'WebcastChatMessage',
        data: { common: { msgId: '1001' }, user: { userId: '123', nickname: 'Ece' }, content: 'A' },
      },
    ],
  };
  consumeEulerFrame(frame, engine, () => {});
  consumeEulerFrame(frame, engine, () => {});
  assert.equal(engine.snapshot().answers, 1);
  engine.advance();
  assert.equal(engine.rankings()[0].correct, 1);
});
test('provider WebSocketServerEvent customEvent JSON is normalized before scoring', () => {
  const engine = setup();
  consumeEulerFrame(
    {
      metadata: { timestampUnixMs: String(Date.now()) },
      customEvent: {
        type: 'WebcastChatMessage',
        json: JSON.stringify({
          common: { msgId: 'custom-1' },
          user: { userId: 'custom-user', nickname: 'JSON test' },
          content: 'A',
        }),
      },
    },
    engine,
    () => {},
  );
  assert.equal(engine.snapshot().answers, 1);
});
test('gift streaks count only at the end and group IDs deduplicate repeated final packets', () => {
  const engine = setup();
  const data = {
    common: { msgId: '1' },
    user: { id: '123', nickname: 'Mert' },
    gift: { type: 1, name: 'Gül', id: '5655' },
    repeatCount: 5,
    groupId: 'streak-1',
    repeatEnd: 0,
  };
  consumeEulerFrame({ type: 'WebcastGiftMessage', data }, engine, () => {});
  assert.equal(engine.snapshot().gifts, 0);
  consumeEulerFrame({ type: 'WebcastGiftMessage', data: { ...data, repeatEnd: 1 } }, engine, () => {});
  consumeEulerFrame(
    { type: 'WebcastGiftMessage', data: { ...data, common: { msgId: '2' }, repeatEnd: 1 } },
    engine,
    () => {},
  );
  assert.equal(engine.snapshot().gifts, 5);
  assert.equal(engine.snapshot().participants, 0);
});
test('unknown, malformed and stale events never score a player', () => {
  const engine = setup();
  for (const frame of [
    null,
    {},
    { messages: [null, {}, { type: 'Unsupported', data: {} }] },
    { type: 'WebcastChatMessage', data: { content: 'A' } },
    {
      type: 'WebcastChatMessage',
      data: { common: { msgId: 'old', createTime: 1 }, user: { userId: '1' }, content: 'A' },
    },
  ])
    consumeEulerFrame(frame, engine, () => {});
  assert.equal(engine.snapshot().participants, 0);
});
test('room status events are surfaced without leaking upstream messages', () => {
  const states: string[] = [];
  consumeEulerFrame(
    {
      messages: [
        { type: 'tiktok.connect', data: {} },
        { type: 'room.status', data: { state: 'reconnecting', message: 'private provider text' } },
      ],
    },
    setup(),
    (state) => states.push(state),
  );
  assert.deepEqual(states, ['connected', 'reconnecting']);
});
test('live source blocks missing credentials and license without starting network requests', () => {
  const engine = new QuizEngine(defaultSettings, () => {});
  const noKey = new LiveSource(engine, undefined, () => true);
  assert.throws(() => noKey.connect('tester'), /EULER_API_KEY/);
  const noLicense = new LiveSource(engine, 'synthetic-test-key', () => false);
  assert.throws(() => noLicense.connect('tester'), /lisans/);
  noKey.cleanup();
  noLicense.cleanup();
});
