import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../src/cli.js';

const execFileP = promisify(execFile);
const cliPath = fileURLToPath(new URL('../src/cli.js', import.meta.url));

test('plain path + flags', () => {
  const { args } = parseArgs(['./svc', '--ci', '--json', '--strict']);
  assert.equal(args.path, './svc');
  assert.equal(args.ci, true);
  assert.equal(args.json, true);
  assert.equal(args.strict, true);
});

test('no path → null (orchestrator defaults to cwd)', () => {
  assert.equal(parseArgs(['--ci']).args.path, null);
});

test('-h / --help', () => {
  assert.equal(parseArgs(['-h']).help, true);
  assert.equal(parseArgs(['--help']).help, true);
});

test('--only / --skip take a validated tool list', () => {
  assert.deepEqual(parseArgs(['--only', 'aiglare,repoctx']).args.only, ['aiglare', 'repoctx']);
  assert.deepEqual(parseArgs(['--skip', 'tieline']).args.skip, ['tieline']);
});

// The blocker: a bare trailing --only/--skip must NOT silently become a no-op.
test('trailing --only with no value → error exit 2', () => {
  const r = parseArgs(['--only']);
  assert.equal(r.error.code, 2);
  assert.match(r.error.message, /--only requires/);
});

test('--only followed by a flag → error (value looks like an option)', () => {
  assert.equal(parseArgs(['--only', '--json']).error.code, 2);
});

test('--skip with no value → error', () => {
  assert.equal(parseArgs(['--skip']).error.code, 2);
});

test('unknown tool in --only → error exit 2', () => {
  const r = parseArgs(['--only', 'nope']);
  assert.equal(r.error.code, 2);
  assert.match(r.error.message, /Unknown tool/);
});

test('unknown option → error exit 2', () => {
  assert.equal(parseArgs(['--bogus']).error.code, 2);
});

test('--skip all four parses (caught later as nothingChecked, not here)', () => {
  const { args } = parseArgs(['--skip', 'aiglare,bouncer,tieline,repoctx']);
  assert.equal(args.skip.length, 4);
});

// Regression: invoked through a symlinked bin (npm link / `npm i -g` / npx),
// argv[1] is the link path. main() must still run — a published CLI that prints
// nothing when globally installed is the worst kind of broken.
test('runs main() when launched via a symlink to the CLI', async () => {
  const link = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gate-bin-')), 'gate');
  fs.symlinkSync(cliPath, link);
  try {
    const { stdout } = await execFileP(process.execPath, [link, '--help']);
    assert.match(stdout, /^gate —/);
    assert.match(stdout, /gate mcp/);
  } finally {
    fs.rmSync(path.dirname(link), { recursive: true, force: true });
  }
});
