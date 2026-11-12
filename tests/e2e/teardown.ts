import { rmSync } from 'node:fs';
import { basename, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';

export default function teardown() {
  const dir = process.env.QUIZCAST_E2E_DATA_DIR;
  if (dir && basename(dir).startsWith('quizcast-e2e-') && resolve(dir).startsWith(resolve(tmpdir()) + sep))
    rmSync(dir, { recursive: true, force: true });
}
