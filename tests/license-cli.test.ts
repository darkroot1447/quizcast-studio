import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { verifyLicense } from '../server/license.js';

test('seller CLI generates keys, issues a verifiable installation license and refuses overwrites', () => {
  const dir = mkdtempSync(join(tmpdir(), 'quizcast-license-'));
  try {
    const run = (...args: string[]) =>
      execFileSync(process.execPath, ['--import', 'tsx', 'scripts/license-cli.ts', ...args], {
        encoding: 'utf8',
        stdio: 'pipe',
      });
    const keyDir = join(dir, 'keys');
    run('keygen', '--out', keyDir);
    assert.throws(() => run('keygen', '--out', keyDir));
    const id = randomUUID();
    const out = join(dir, 'test.license.json');
    run(
      'issue',
      '--key',
      join(keyDir, 'private.pem'),
      '--customer',
      'Sentetik test müşterisi',
      '--installation',
      id,
      '--days',
      '30',
      '--out',
      out,
    );
    const info = verifyLicense(
      JSON.parse(readFileSync(out, 'utf8')),
      readFileSync(join(keyDir, 'public.pem'), 'utf8'),
      id,
    );
    assert.equal(info.status, 'valid');
    assert.equal(info.customer, 'Sentetik test müşterisi');
    assert.throws(() =>
      run(
        'issue',
        '--key',
        join(keyDir, 'private.pem'),
        '--customer',
        'Test',
        '--installation',
        id,
        '--days',
        '30',
        '--out',
        out,
      ),
    );
  } finally {
    rmSync(dir, { recursive: true });
  }
});
