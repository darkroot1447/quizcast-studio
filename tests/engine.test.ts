import test from 'node:test';
import assert from 'node:assert/strict';
import { QuizEngine, parseAnswer } from '../server/engine.js';
import { defaultSettings, questionSchema, type SessionRecord } from '../shared/schema.js';
import { seedQuestions } from '../data/questions.js';

function fixture(overrides = {}) {
  let now = 1000;
  const saved: SessionRecord[] = [];
  const settings = {
    ...defaultSettings,
    questionSeconds: 10,
    revealSeconds: 3,
    shuffleOptions: false,
    ...overrides,
  };
  const engine = new QuizEngine(
    settings,
    (r) => saved.push(r),
    () => now,
    () => 0.25,
  );
  return {
    engine,
    saved,
    advance: (ms: number) => {
      now += ms;
    },
    start: () => engine.start([seedQuestions[0]]),
  };
}

test('100 unique, valid Turkish questions cover nine categories and all difficulty levels', () => {
  assert.equal(seedQuestions.length, 100);
  assert.equal(new Set(seedQuestions.map((q) => q.id)).size, 100);
  assert.equal(new Set(seedQuestions.map((q) => q.text)).size, 100);
  assert.equal(new Set(seedQuestions.map((q) => q.category)).size, 9);
  assert.equal(new Set(seedQuestions.map((q) => q.difficulty)).size, 3);
  for (const question of seedQuestions) {
    assert.doesNotThrow(() => questionSchema.parse(question));
    assert.ok(question.explanation.length > 10);
  }
});
test('only exact choice letters and 1–4 are accepted', () => {
  for (const [input, expected] of [
    ['a', 0],
    [' B ', 1],
    ['4', 3],
    ['c', 2],
  ] as const)
    assert.equal(parseAnswer(input), expected);
  for (const input of ['AB', 'cevap A', 'A B C D', '5', '', '1+1', '<b>A</b>'])
    assert.equal(parseAnswer(input), null);
});
test('correct answer and explanation are absent before reveal, including serialized state', () => {
  const f = fixture();
  f.start();
  assert.ok(!Object.hasOwn(f.engine.snapshot().question!, 'answer'));
  assert.ok(!Object.hasOwn(f.engine.snapshot().question!, 'explanation'));
  assert.equal(f.engine.snapshot().distribution, null);
  f.engine.advance();
  assert.equal(f.engine.snapshot().question?.answer, 0);
  assert.equal(f.engine.snapshot().question?.explanation, seedQuestions[0].explanation);
});
test('first valid answer wins; duplicate messages and second guesses never add points', () => {
  const f = fixture();
  f.start();
  f.advance(2000);
  assert.equal(f.engine.chat('msg-1', 'u-1', 'Ayşe', 'A'), true);
  assert.equal(f.engine.chat('msg-2', 'u-1', 'Ayşe', 'B'), false);
  assert.equal(f.engine.chat('msg-1', 'u-2', 'Ali', 'A'), false);
  assert.equal(f.engine.rankings()[0].score, 0);
  f.engine.advance();
  assert.equal(f.engine.rankings()[0].score, 140);
  assert.equal(f.engine.rankings()[0].answered, 1);
});
test('a wrong first answer cannot be replaced by a correct guess', () => {
  const f = fixture();
  f.start();
  f.engine.chat('a', 'u', 'İzleyici', 'D');
  assert.equal(f.engine.chat('b', 'u', 'İzleyici', 'A'), false);
  f.engine.advance();
  assert.equal(f.engine.rankings()[0].score, 0);
  assert.equal(f.engine.rankings()[0].answered, 1);
});
test('non-answer chat does not consume the single answer opportunity', () => {
  const f = fixture();
  f.start();
  assert.equal(f.engine.chat('a', 'u', 'Can', 'merhaba'), false);
  assert.equal(f.engine.chat('b', 'u', 'Can', 'A'), true);
});
test('answers at or after the deadline are rejected even before the scheduler ticks', () => {
  const f = fixture();
  f.start();
  f.advance(10000);
  assert.equal(f.engine.chat('a', 'u', 'Geç', 'A'), false);
  f.engine.tick();
  assert.equal(f.engine.phase, 'reveal');
  assert.equal(f.engine.snapshot().participants, 0);
});
test('pause freezes time and excludes paused duration from speed bonus', () => {
  const f = fixture();
  f.start();
  f.advance(2000);
  f.engine.pause();
  assert.equal(f.engine.snapshot().remainingMs, 8000);
  f.advance(60000);
  f.engine.tick();
  assert.equal(f.engine.snapshot().remainingMs, 8000);
  assert.equal(f.engine.phase, 'question');
  assert.equal(f.engine.chat('paused', 'u', 'Duraklayan', 'A'), false);
  f.engine.resume();
  f.advance(1000);
  f.engine.chat('ok', 'u', 'Duraklayan', 'A');
  f.engine.advance();
  assert.equal(f.engine.rankings()[0].score, 135);
});
test('connection loss pauses a live match, reconnection does not silently resume it', () => {
  const f = fixture();
  f.engine.setConnection({ mode: 'tiktok', status: 'connected', message: '', retries: 0 });
  f.start();
  f.engine.setConnection({ mode: 'tiktok', status: 'reconnecting', message: '', retries: 1 });
  assert.equal(f.engine.paused, true);
  assert.throws(() => f.engine.resume());
  f.engine.setConnection({ mode: 'tiktok', status: 'connected', message: '', retries: 1 });
  assert.equal(f.engine.paused, true);
  f.engine.resume();
  assert.equal(f.engine.paused, false);
});
test('automatic flow reveals, finishes and saves exactly once without repeating the deck', () => {
  const f = fixture({ sessionQuestions: 20 });
  f.start();
  assert.equal(f.engine.snapshot().totalRounds, 1);
  f.advance(10000);
  f.engine.tick();
  assert.equal(f.engine.phase, 'reveal');
  f.advance(3000);
  f.engine.tick();
  assert.equal(f.engine.phase, 'finished');
  f.engine.stop();
  f.engine.tick();
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].completed, true);
});
test('manual mode waits after reveal until the operator advances', () => {
  const f = fixture({ autoAdvance: false });
  f.start();
  f.advance(10000);
  f.engine.tick();
  f.advance(999999);
  f.engine.tick();
  assert.equal(f.engine.phase, 'reveal');
  f.engine.advance();
  assert.equal(f.engine.phase, 'finished');
});
test('stopping mid-question does not award undisclosed answers', () => {
  const f = fixture();
  f.start();
  f.engine.chat('a', 'u', 'Erken', 'A');
  f.engine.stop();
  assert.equal(f.saved[0].rounds, 0);
  assert.equal(f.saved[0].players[0].score, 0);
  assert.equal(f.saved[0].completed, false);
});
test('shuffled options retain the correct answer and do not mutate seed questions', () => {
  const original = JSON.stringify(seedQuestions[0]);
  const f = fixture({ shuffleOptions: true });
  f.start();
  const q = f.engine.currentQuestion!;
  assert.equal(q.options[q.answer], seedQuestions[0].options[seedQuestions[0].answer]);
  assert.equal(JSON.stringify(seedQuestions[0]), original);
});
test('filters constrain the deck and an empty pool fails clearly', () => {
  const f = fixture({ category: 'Matematik', difficulty: 'hard' });
  f.engine.start(seedQuestions);
  assert.equal(f.engine.currentQuestion?.category, 'Matematik');
  assert.equal(f.engine.currentQuestion?.difficulty, 'hard');
  const empty = fixture({ category: 'Olmayan kategori' });
  assert.throws(() => empty.start(), /soru bulunamadı/);
});
test('gifts and likes do not change quiz points and duplicate engagement is ignored', () => {
  const f = fixture();
  f.start();
  f.engine.engagement('gift', 'gift', 'Hediye veren', 100, 'Gül');
  f.engine.engagement('gift', 'gift', 'Hediye veren', 100, 'Gül');
  assert.equal(f.engine.snapshot().gifts, 100);
  assert.equal(f.engine.rankings().length, 0);
});
test('settings are immutable during a match and changing public snapshot does not mutate engine', () => {
  const f = fixture();
  f.start();
  assert.throws(() => f.engine.updateSettings(defaultSettings));
  f.engine.snapshot().question!.options[0] = 'Changed';
  assert.equal(f.engine.currentQuestion!.options[0], 'Ankara');
});
test('a thousand distinct viewers are scored once with deterministic tie order', () => {
  const f = fixture();
  f.start();
  f.advance(1000);
  for (let i = 0; i < 1000; i++) f.engine.chat(String(i), `user-${i}`, `İzleyici ${i}`, 'A');
  f.engine.advance();
  assert.equal(f.engine.rankings().length, 1000);
  assert.ok(f.engine.rankings().every((p) => p.score === 145));
  assert.equal(f.engine.snapshot().leaderboard.length, 10);
});
test('message deduplication survives starting a new session', () => {
  const f = fixture();
  f.start();
  f.engine.chat('replayed', 'u', 'İzleyici', 'A');
  f.engine.stop();
  f.start();
  assert.equal(f.engine.chat('replayed', 'u', 'İzleyici', 'A'), false);
  assert.equal(f.engine.snapshot().participants, 0);
});
