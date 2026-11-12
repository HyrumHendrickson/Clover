#!/usr/bin/env node
/**
 * Rebuilds vendor/siglum from the npm package. Run it only to upgrade the engine, then update the checksums in
 * scripts/verify-vendor.mjs. Needs network access and writes into vendor/siglum.
 * Usage: node scripts/vendor-siglum.mjs 0.2.2
 */
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const version = process.argv[2] ?? '0.2.2';
const out = fileURLToPath(new URL('../vendor/siglum/', import.meta.url));
const work = await mkdtemp(join(tmpdir(), 'siglum-'));
const run = (command, args) => execFileSync(command, args, { cwd: work, stdio: 'inherit' });

run('npm', ['init', '-y']);
run('npm', ['install', `@siglum/engine@${version}`, 'esbuild', '--no-audit', '--no-fund']);
await writeFile(
  join(work, 'blake-off.js'),
  "export function hash() { throw new Error('BLAKE3 acceleration disabled'); }\n",
);
const src = 'node_modules/@siglum/engine/src';
const common = ['--bundle', '--target=es2022', '--minify'];
run('npx', [
  'esbuild',
  `${src}/index.js`,
  ...common,
  '--format=esm',
  '--alias:blake3-wasm/browser.js=./blake-off.js',
  `--outfile=${join(out, 'engine.js')}`,
]);
// The worker loads TeX with importScripts, so it must be a classic script.
run('npx', ['esbuild', `${src}/worker.js`, ...common, '--format=iife', `--outfile=${join(out, 'worker.js')}`]);
await cp(join(work, 'node_modules/@siglum/engine/LICENSE'), join(out, 'LICENSE'));
console.log('Done. Update the checksums in scripts/verify-vendor.mjs.');
