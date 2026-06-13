import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTool } from '../src/resolve.js';

const aiglareSpec = {
  tool: 'aiglare',
  pkg: '@nugehs/aiglare',
  binRel: 'src/cli.js',
  binName: 'aiglare',
};

test('env override wins when the path exists', () => {
  const self = fileURLToPath(import.meta.url); // any real file
  process.env.GATE_AIGLARE_BIN = self;
  try {
    const r = resolveTool(aiglareSpec);
    assert.equal(r.source, 'env');
    assert.equal(r.entry, self);
  } finally {
    delete process.env.GATE_AIGLARE_BIN;
  }
});

test('env override ignored when the path does not exist', () => {
  process.env.GATE_AIGLARE_BIN = '/no/such/path/cli.js';
  try {
    const r = resolveTool(aiglareSpec);
    assert.notEqual(r?.source, 'env');
  } finally {
    delete process.env.GATE_AIGLARE_BIN;
  }
});

test('falls back to a sibling checkout when env + node_modules miss', () => {
  // Hermetic: build a throwaway layout <tmp>/faketool/bin.js and pretend gate
  // lives at <tmp>/gate. faketool is not a real package, so env + node_modules
  // both miss and the sibling fallback (root/../faketool/bin.js) wins.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-resolve-'));
  const bin = path.join(tmp, 'faketool', 'bin.js');
  fs.mkdirSync(path.dirname(bin), { recursive: true });
  fs.writeFileSync(bin, '// fake tool');
  try {
    const r = resolveTool(
      { tool: 'faketool', pkg: '@nugehs/faketool', binRel: 'bin.js', binName: 'faketool' },
      { root: path.join(tmp, 'gate') }
    );
    assert.ok(r, 'expected sibling resolution');
    assert.equal(r.source, 'sibling');
    assert.equal(r.entry, bin);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('unresolvable tool → null (reported as skipped, never a crash)', () => {
  const r = resolveTool(
    { tool: 'doesnotexist', pkg: '@nugehs/doesnotexist', binRel: 'x.js', binName: 'x' },
    { root: path.join(os.tmpdir(), 'gate-nope') }
  );
  assert.equal(r, null);
});
