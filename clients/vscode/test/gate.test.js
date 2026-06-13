// Unit tests for the pure logic in src/gate.ts, run against the compiled output.
// (CommonJS — this extension package is not type:module.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { statusBarText, toTree, toDiagnostics, resolveGate, parseVerdict } = require('../out/gate.js');

function verdict(over = {}) {
  return {
    schemaVersion: 1,
    tool: 'gate',
    generatedAt: '2026-06-13T00:00:00.000Z',
    repo: { root: '/r', name: 'demo' },
    verdict: 'fail',
    ok: false,
    summary: { domains: 4, pass: 1, warn: 1, fail: 1, skipped: 1, ran: 3 },
    gate: { ci: false, strict: false, failed: false, nothingChecked: false, reasons: [] },
    domains: [
      { tool: 'aiglare', domain: 'ai-governance', label: 'AI governance', status: 'fail', summary: '1 blocking', findings: [{ id: 'pay.ts', title: 'pay.ts', severity: 'red' }] },
      { tool: 'repoctx', domain: 'merge-readiness', label: 'Merge readiness', status: 'warn', summary: '1 of 8' },
    ],
    ...over,
  };
}

test('statusBarText: running spinner', () => {
  assert.match(statusBarText(null, true).text, /sync~spin/);
});

test('statusBarText: not-run state', () => {
  assert.match(statusBarText(null, false).text, /circle-outline/);
});

test('statusBarText: fail shows error icon + FAIL', () => {
  const { text, tooltip } = statusBarText(verdict(), false);
  assert.match(text, /\$\(error\) gate: FAIL/);
  assert.match(tooltip, /AI governance: fail/);
});

test('statusBarText: pass shows pass icon', () => {
  assert.match(statusBarText(verdict({ verdict: 'pass' }), false).text, /\$\(pass\) gate: PASS/);
});

test('statusBarText: nothingChecked is surfaced, not a green pass', () => {
  const v = verdict({ verdict: 'pass', gate: { ci: false, strict: false, failed: false, nothingChecked: true, reasons: ['no checks ran'] } });
  const { text } = statusBarText(v, false);
  assert.match(text, /nothing checked/);
  assert.doesNotMatch(text, /PASS/);
});

test('toTree: domains become roots, findings become children', () => {
  const roots = toTree(verdict());
  assert.equal(roots.length, 2);
  assert.equal(roots[0].label, 'AI governance');
  assert.equal(roots[0].status, 'fail');
  assert.equal(roots[0].children.length, 1);
  assert.equal(roots[0].children[0].label, 'pay.ts');
});

test('toTree: null verdict → placeholder', () => {
  const roots = toTree(null);
  assert.equal(roots.length, 1);
  assert.match(roots[0].label, /Run gate/);
});

test('resolveGate: explicit .js path runs under node', () => {
  const inv = resolveGate({ configuredPath: '/x/src/cli.js', workspaceRoot: '/r' });
  assert.equal(inv.command, process.execPath);
  assert.deepEqual(inv.args, ['/x/src/cli.js']);
});

test('resolveGate: explicit binary path used directly', () => {
  const inv = resolveGate({ configuredPath: '/usr/local/bin/gate', workspaceRoot: '/r' });
  assert.equal(inv.command, '/usr/local/bin/gate');
  assert.deepEqual(inv.args, []);
});

test('resolveGate: no config + no local bin → bare `gate` (npx fallback handled by runner)', () => {
  const inv = resolveGate({ workspaceRoot: '/no/such/workspace' });
  assert.equal(inv.command, 'gate');
});

test('parseVerdict: clean + banner-prefixed JSON', () => {
  assert.equal(parseVerdict('{"verdict":"pass"}').verdict, 'pass');
  assert.equal(parseVerdict('noise\n{"verdict":"warn"}\n').verdict, 'warn');
  assert.equal(parseVerdict('garbage'), null);
});

test('toDiagnostics: located findings → descriptors; relative resolved, absolute kept', () => {
  const v = verdict({
    repo: { root: '/work/app', name: 'app' },
    domains: [
      { tool: 'aiglare', label: 'AI governance', status: 'fail', summary: '', findings: [{ title: 'pay.ts', severity: 'red', file: 'src/pay.ts', line: 42 }] },
      { tool: 'tieline', label: 'Contract drift', status: 'fail', summary: '', findings: [{ title: 'GET /x', severity: 'drift', file: '/abs/api.ts', line: 7 }] },
      { tool: 'repoctx', label: 'Merge readiness', status: 'warn', summary: '', findings: [{ title: 'Review state' /* no file */ }] },
    ],
  });
  const ds = toDiagnostics(v);
  assert.equal(ds.length, 2); // repoctx finding has no file → excluded
  assert.equal(ds[0].file, path.join('/work/app', 'src/pay.ts')); // relative resolved against repo root
  assert.equal(ds[0].line, 42);
  assert.match(ds[0].message, /AI governance: pay\.ts \(red\)/);
  assert.equal(ds[0].source, 'gate/aiglare');
  assert.equal(ds[1].file, '/abs/api.ts'); // absolute kept as-is
});

test('toDiagnostics: null verdict → empty, missing line → 1', () => {
  assert.deepEqual(toDiagnostics(null), []);
  const v = verdict({ domains: [{ tool: 'aiglare', label: 'AI governance', status: 'fail', summary: '', findings: [{ title: 'x', file: '/a.ts' }] }] });
  assert.equal(toDiagnostics(v)[0].line, 1);
});

test('toTree: finding file is resolved to absolute', () => {
  const v = verdict({
    repo: { root: '/work/app', name: 'app' },
    domains: [{ tool: 'aiglare', label: 'AI governance', status: 'fail', summary: '', findings: [{ title: 'pay.ts', file: 'src/pay.ts', line: 42 }] }],
  });
  const node = toTree(v)[0].children[0];
  assert.equal(node.file, path.join('/work/app', 'src/pay.ts'));
  assert.equal(node.line, 42);
});
