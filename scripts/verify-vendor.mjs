#!/usr/bin/env node
/** Verifies vendored third-party files against their recorded SHA-256 checksums. */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const EXPECTED = {
  'vendor/skulpt/skulpt.min.js': '1a319d8eedf314dba5af2444313e3cf2ac072a335df0f5100277e8f49b64eae9',
  'vendor/skulpt/skulpt-stdlib.js': 'e3ecccbc17c6164d19ed3c5561aaaeb752c38c8efa2d88b62b5fb7a7e1b086a7',
};

let failed = false;
for (const [file, expected] of Object.entries(EXPECTED)) {
  const actual = createHash('sha256')
    .update(await readFile(join(root, file)))
    .digest('hex');
  const ok = actual === expected;
  failed ||= !ok;
  console.log(`${ok ? 'ok     ' : 'MISMATCH'} ${file}`);
}
process.exit(failed ? 1 : 0);
