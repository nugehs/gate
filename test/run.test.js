import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTool, extractJson } from '../src/run.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (p) => path.join(here, 'fixtures', p);

test('extractJson parses clean JSON', () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('[1,2,3]'), [1, 2, 3]);
});

test('extractJson recovers from a leading noise line', () => {
  assert.deepEqual(extractJson('Using repoctx index\n{"a":1}\n'), { a: 1 });
});

test('extractJson grabs the outermost object when trailing junk follows', () => {
  assert.deepEqual(extractJson('{"a":{"b":2}}\nDone.'), { a: { b: 2 } });
});

test('extractJson returns null for pure garbage / empty', () => {
  assert.equal(extractJson('not json at all'), null);
  assert.equal(extractJson(''), null);
  assert.equal(extractJson(null), null);
});

test('runTool captures full stdout and the exit code of a clean tool', async () => {
  const res = await runTool(fx('tool-json.mjs'), [], { cwd: here });
  assert.equal(res.exitCode, 0);
  assert.deepEqual(extractJson(res.stdout), { ok: true, value: 42 });
});

test('runTool reports a non-zero exit without throwing, stdout still captured', async () => {
  const res = await runTool(fx('tool-noconfig.mjs'), [], { cwd: here });
  assert.equal(res.exitCode, 2);
  assert.match(res.stdout, /No faketool\.config\.json found/);
});
