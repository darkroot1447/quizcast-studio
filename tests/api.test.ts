import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { get as httpGet } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApplication, csvCell } from '../server/app.js';
import { Store } from '../server/store.js';
import { seedQuestions } from '../data/questions.js';

async function fixture(t: TestContext) {
  const runtime = createApplication({ databasePath: ':memory:', demoAuto: false });
  const server = runtime.app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('address');
  const base = `http://127.0.0.1:${address.port}`;
  let cookie = '';
  t.after(async () => {
    runtime.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    extraHeaders: Record<string, string> = {},
  ) {
    const response = await fetch(base + path, {
      method,
      headers: { Origin: base, Cookie: cookie, 'Content-Type': 'application/json', ...extraHeaders },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return response;
  }
  async function login() {
    const response = await request('/api/setup', 'POST', { password: 'A-test-only-password-1234' });
    assert.equal(response.status, 200);
    cookie = response.headers.get('set-cookie')!.split(';')[0];
    return response;
  }
  return { ...runtime, request, login, base };
}

test('admin APIs require authentication; overlay token never grants admin access', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/admin/state')).status, 401);
  assert.equal((await f.request('/api/admin/game/start', 'POST')).status, 401);
  assert.equal((await f.request(`/api/admin/state?token=${f.store.get('overlayToken')}`)).status, 401);
});
test('setup is one-time, sets HttpOnly SameSite cookie, logout revokes it', async (t) => {
  const f = await fixture(t);
  const response = await f.login();
  assert.match(response.headers.get('set-cookie')!, /HttpOnly/);
  assert.match(response.headers.get('set-cookie')!, /SameSite=Strict/);
  assert.equal(
    (await f.request('/api/setup', 'POST', { password: 'Another-test-password-1234' })).status,
    400,
  );
  assert.equal((await f.request('/api/admin/state')).status, 200);
  assert.equal((await f.request('/api/logout', 'POST')).status, 200);
  assert.equal((await f.request('/api/admin/state')).status, 401);
});
test('wrong origin and DNS rebinding host are blocked', async (t) => {
  const f = await fixture(t);
  await f.login();
  assert.equal(
    (await f.request('/api/admin/game/start', 'POST', undefined, { Origin: 'https://evil.example' })).status,
    403,
  );
  // Fetch rewrites the Host header; a raw HTTP request exercises DNS-rebinding protection.
  const status = await new Promise<number | undefined>((resolve, reject) => {
    httpGet(f.base + '/api/admin/state', { headers: { Host: 'evil.example' } }, (response) => {
      response.resume();
      resolve(response.statusCode);
    }).on('error', reject);
  });
  assert.equal(status, 403);
});
test('weak passwords are rejected and repeated authentication attempts are rate-limited', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/setup', 'POST', { password: 'short' })).status, 400);
  for (let i = 0; i < 7; i++) await f.request('/api/login', 'POST', { password: 'Not-the-right-password' });
  assert.equal((await f.request('/api/login', 'POST', { password: 'Not-the-right-password' })).status, 429);
});
test('overlay access validates token and masks answer before reveal', async (t) => {
  const f = await fixture(t);
  await f.login();
  assert.equal((await f.request('/api/overlay/state?token=wrong')).status, 403);
  assert.equal(
    (await f.request(`/api/overlay/state?token=${encodeURIComponent('é'.repeat(64))}`)).status,
    403,
  );
  const token = f.store.get<string>('overlayToken');
  await f.request('/api/admin/game/start', 'POST');
  let snapshot = await (await f.request(`/api/overlay/state?token=${token}`)).json();
  assert.equal(snapshot.phase, 'question');
  assert.equal(Object.hasOwn(snapshot.question, 'answer'), false);
  await f.request('/api/admin/game/next', 'POST');
  snapshot = await (await f.request(`/api/overlay/state?token=${token}`)).json();
  assert.equal(typeof snapshot.question.answer, 'number');
});
test('public SSE sends only read-only state and rejects missing credentials', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/events')).status, 401);
  const response = await f.request(`/api/events?token=${f.store.get('overlayToken')}`);
  assert.match(response.headers.get('content-type')!, /text\/event-stream/);
  const reader = response.body!.getReader();
  const first = await reader.read();
  await reader.cancel();
  const payload = JSON.parse(
    new TextDecoder()
      .decode(first.value)
      .trim()
      .replace(/^data: /, ''),
  );
  assert.equal(payload.phase, 'idle');
  assert.equal('questions' in payload, false);
  assert.equal('overlayToken' in payload, false);
});
test('question CRUD and atomic validated imports, including duplicate detection', async (t) => {
  const f = await fixture(t);
  await f.login();
  const created = await f.request('/api/admin/questions', 'POST', {
    ...seedQuestions[0],
    id: 'ignored',
    text: 'Yeni bir test sorusu nedir?',
  });
  assert.equal(created.status, 201);
  const q = await created.json();
  assert.notEqual(q.id, 'ignored');
  assert.equal((await f.request('/api/admin/questions', 'POST', q)).status, 409);
  assert.equal(
    (await f.request(`/api/admin/questions/${q.id}`, 'PUT', { ...q, text: 'Düzenlenen test sorusu nedir?' }))
      .status,
    200,
  );
  const before = f.store.questions().length;
  assert.equal(
    (
      await f.request('/api/admin/questions/import', 'POST', [
        { ...seedQuestions[0], id: 'new-import', text: 'Bir başka yeni soru nedir?' },
        { ...seedQuestions[1], answer: 99 },
      ])
    ).status,
    400,
  );
  assert.equal(f.store.questions().length, before);
  assert.equal((await f.request(`/api/admin/questions/${q.id}`, 'DELETE')).status, 200);
  assert.equal(f.store.questions().length, 100);
});
test('live connection is fail-closed without key/license; demo still works', async (t) => {
  const f = await fixture(t);
  await f.login();
  assert.equal((await f.request('/api/admin/source', 'POST', { mode: 'tiktok' })).status, 400);
  assert.equal((await f.request('/api/admin/game/start', 'POST')).status, 200);
  const response = await f.request('/api/admin/demo', 'POST', { name: 'Deneme', answer: 'A' });
  assert.equal((await response.json()).accepted, true);
  assert.equal((await f.request('/api/admin/source', 'POST', { mode: 'tiktok' })).status, 400);
  assert.equal(f.engine.connection.mode, 'demo');
  assert.equal((await f.request('/api/admin/source', 'POST', { mode: 'disconnect' })).status, 400);
  assert.equal(f.engine.connection.mode, 'demo');
});
test('settings and question changes cannot mutate an active match', async (t) => {
  const f = await fixture(t);
  await f.login();
  await f.request('/api/admin/game/start', 'POST');
  assert.equal((await f.request('/api/admin/settings', 'PUT', f.store.settings)).status, 400);
  assert.equal((await f.request('/api/admin/questions/tr-001', 'DELETE')).status, 400);
});
test('rotating overlay token invalidates old links', async (t) => {
  const f = await fixture(t);
  await f.login();
  const old = f.store.get<string>('overlayToken');
  await f.request('/api/admin/overlay/rotate', 'POST');
  assert.notEqual(f.store.get('overlayToken'), old);
  assert.equal((await f.request(`/api/overlay/state?token=${old}`)).status, 403);
});
test('CSV output neutralizes spreadsheet formulas and quotes embedded delimiters', () => {
  assert.equal(csvCell('=1+1'), '"\'=1+1"');
  assert.equal(csvCell(' +SUM(A1)'), '"\' +SUM(A1)"');
  assert.equal(csvCell('A,"B"'), '"A,""B"""');
  assert.equal(csvCell(100), '"100"');
});
test('SQLite retains settings, questions, credentials and installation identity across restarts', () => {
  const directory = mkdtempSync(join(tmpdir(), 'quizcast-store-'));
  try {
    const first = new Store(join(directory, 'test.sqlite'));
    const id = first.get('installationId');
    first.set('settings', { ...first.settings, title: 'Kalıcı test' });
    first.setup('A-persistent-test-password');
    first.deleteQuestion('tr-001');
    first.close();
    const second = new Store(join(directory, 'test.sqlite'));
    assert.equal(second.settings.title, 'Kalıcı test');
    assert.equal(second.get('installationId'), id);
    assert.equal(second.questions().length, 99);
    assert.equal(second.authenticate('A-persistent-test-password'), true);
    assert.equal(second.authenticate('Wrong-password-123'), false);
    second.close();
  } finally {
    rmSync(directory, { recursive: true });
  }
});
