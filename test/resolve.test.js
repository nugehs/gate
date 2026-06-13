import { test } from 'node:test';
import assert from 'node:assert/strict';
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

test('falls back to the sibling checkout (../aiglare/src/cli.js)', () => {
  // gate is not `npm install`ed in dev, so node_modules resolution misses and
  // the sibling path under ~/projects is used.
  const r = resolveTool(aiglareSpec);
  assert.ok(r, 'expected aiglare to resolve via sibling checkout');
  assert.match(r.entry, /aiglare\/src\/cli\.js$/);
});

test('unresolvable tool → null (reported as skipped, never a crash)', () => {
  const r = resolveTool({ tool: 'doesnotexist', pkg: '@nugehs/doesnotexist', binRel: 'x.js', binName: 'x' });
  assert.equal(r, null);
});
