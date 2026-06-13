import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAdapter } from '../src/orchestrator.js';
import { STATUS } from '../src/verdict.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = (p) => path.join(here, 'fixtures', p);

// A synthetic adapter whose CLI we control via GATE_FAKETOOL_BIN. tool='faketool'
// has no @nugehs package and no sibling, so resolution falls entirely to the env.
function fakeAdapter(overrides = {}) {
  return {
    tool: 'faketool',
    pkg: '@nugehs/faketool',
    binRel: 'x.js',
    binName: 'faketool',
    domain: 'fake',
    label: 'Fake',
    args: () => [],
    normalize: (json) => ({
      status: json.ok ? STATUS.PASS : STATUS.FAIL,
      summary: `value=${json.value}`,
      counts: { value: json.value },
      findings: [],
    }),
    ...overrides,
  };
}

async function withBin(fixture, fn) {
  process.env.GATE_FAKETOOL_BIN = fixture ? fx(fixture) : '/no/such/bin.js';
  try {
    return await fn();
  } finally {
    delete process.env.GATE_FAKETOOL_BIN;
  }
}

test('clean JSON → normalize result, available + source=env', async () => {
  const r = await withBin('tool-json.mjs', () => runAdapter(fakeAdapter(), { path: here }));
  assert.equal(r.status, STATUS.PASS);
  assert.equal(r.summary, 'value=42');
  assert.equal(r.available, true);
  assert.equal(r.source, 'env');
  assert.equal(r.exitCode, 0);
  assert.equal(r.error, null);
});

test('non-JSON output → ERROR (no parseable output)', async () => {
  const r = await withBin('tool-garbage.mjs', () => runAdapter(fakeAdapter(), { path: here }));
  assert.equal(r.status, STATUS.ERROR);
  assert.match(r.summary, /no parseable output/);
});

test('not-configured (skip detector matches) → SKIPPED before any error', async () => {
  const adapter = fakeAdapter({
    skip: (res) => (/no\s+\S*config(?:\.json)?\s+found/i.test(`${res.stdout}\n${res.stderr}`) ? 'not configured' : null),
  });
  const r = await withBin('tool-noconfig.mjs', () => runAdapter(adapter, { path: here }));
  assert.equal(r.status, STATUS.SKIPPED);
  assert.equal(r.summary, 'not configured');
});

test('crash with no usable output → ERROR', async () => {
  const r = await withBin('tool-crash.mjs', () => runAdapter(fakeAdapter(), { path: here }));
  assert.equal(r.status, STATUS.ERROR);
});

test('normalize that throws is caught → ERROR (could not interpret)', async () => {
  const adapter = fakeAdapter({
    normalize: () => {
      throw new Error('schema drifted');
    },
  });
  const r = await withBin('tool-json.mjs', () => runAdapter(adapter, { path: here }));
  assert.equal(r.status, STATUS.ERROR);
  assert.match(r.error, /schema drifted/);
});

test('unresolvable tool → SKIPPED, available=false (never a crash)', async () => {
  const r = await runAdapter(fakeAdapter(), { path: here }); // no env, no pkg, no sibling
  assert.equal(r.status, STATUS.SKIPPED);
  assert.equal(r.available, false);
  assert.match(r.error, /not installed|resolve/i);
});
