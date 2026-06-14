// Tests for the multi-root aggregation and finding-mute logic in src/gate.ts,
// run against the compiled output. (CommonJS — this package is not type:module.)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  overallStatus,
  statusBarTextMulti,
  toTreeMulti,
  toDiagnosticsMulti,
  findingsForFile,
  findingKey,
  toDiagnostics,
} = require('../out/gate.js');

function verdict(over = {}) {
  return {
    schemaVersion: 1,
    tool: 'gate',
    generatedAt: '2026-06-14T00:00:00.000Z',
    repo: { root: '/work/app', name: 'app' },
    verdict: 'fail',
    ok: false,
    summary: {},
    gate: { ci: false, strict: false, failed: false, nothingChecked: false, reasons: [] },
    domains: [
      {
        tool: 'aiglare',
        domain: 'ai-governance',
        label: 'AI governance',
        status: 'fail',
        summary: '1 blocking',
        findings: [{ title: 'pay.ts', severity: 'red', file: 'src/pay.ts', line: 42 }],
      },
    ],
    ...over,
  };
}

function folder(name, root, v, error) {
  return { folder: '/work/' + name, name, verdict: v ?? null, error };
}

// ---- overallStatus ----

test('overallStatus: empty → none', () => {
  assert.equal(overallStatus([]), 'none');
});

test('overallStatus: worst wins (fail beats warn beats pass)', () => {
  const pass = folder('a', '/work/a', verdict({ verdict: 'pass' }));
  const warn = folder('b', '/work/b', verdict({ verdict: 'warn' }));
  const fail = folder('c', '/work/c', verdict({ verdict: 'fail' }));
  assert.equal(overallStatus([pass]), 'pass');
  assert.equal(overallStatus([pass, warn]), 'warn');
  assert.equal(overallStatus([pass, warn, fail]), 'fail');
});

test('overallStatus: error / null / nothingChecked count as warn, never pass', () => {
  assert.equal(overallStatus([folder('a', '/a', null, 'Could not run gate')]), 'warn');
  assert.equal(overallStatus([folder('a', '/a', null)]), 'warn');
  const nothing = folder('b', '/b', verdict({ verdict: 'pass', gate: { nothingChecked: true, reasons: ['no checks ran'] } }));
  assert.equal(overallStatus([nothing]), 'warn');
});

// ---- statusBarTextMulti ----

test('statusBarTextMulti: no folders → not-run, running → spinner', () => {
  assert.match(statusBarTextMulti([], false).text, /circle-outline/);
  assert.match(statusBarTextMulti([], true).text, /sync~spin/);
});

test('statusBarTextMulti: single folder delegates to the single-verdict view', () => {
  const one = folder('app', '/work/app', verdict({ verdict: 'fail' }));
  assert.match(statusBarTextMulti([one], false).text, /\$\(error\) gate: FAIL/);
});

test('statusBarTextMulti: many folders show worst verdict + count', () => {
  const a = folder('a', '/work/a', verdict({ verdict: 'pass' }));
  const b = folder('b', '/work/b', verdict({ verdict: 'fail' }));
  const { text, tooltip } = statusBarTextMulti([a, b], false);
  assert.match(text, /gate: FAIL · 2 folders/);
  assert.match(tooltip, /a: PASS/);
  assert.match(tooltip, /b: FAIL/);
});

// ---- toTreeMulti ----

test('toTreeMulti: empty → placeholder; single → domains at root', () => {
  assert.match(toTreeMulti([])[0].label, /Run gate/);
  const roots = toTreeMulti([folder('app', '/work/app', verdict())]);
  assert.equal(roots[0].label, 'AI governance');
  assert.equal(roots[0].children[0].label, 'pay.ts');
});

test('toTreeMulti: many folders get a folder layer on top', () => {
  const a = folder('a', '/work/a', verdict({ repo: { root: '/work/a', name: 'a' } }));
  const b = folder('b', '/work/b', verdict({ repo: { root: '/work/b', name: 'b' }, verdict: 'warn' }));
  const roots = toTreeMulti([a, b]);
  assert.equal(roots.length, 2);
  assert.equal(roots[0].label, 'a');
  assert.equal(roots[0].children[0].label, 'AI governance'); // domain nested under folder
});

// ---- diagnostics + muting ----

const fa = folder(
  'a',
  '/work/a',
  verdict({
    repo: { root: '/work/a', name: 'a' },
    domains: [{ tool: 'aiglare', label: 'AI governance', status: 'fail', summary: 'x', findings: [{ title: 'pay.ts', severity: 'red', file: 'src/pay.ts', line: 42 }] }],
  })
);
const fb = folder(
  'b',
  '/work/b',
  verdict({
    repo: { root: '/work/b', name: 'b' },
    verdict: 'warn',
    domains: [{ tool: 'tieline', label: 'Contract drift', status: 'warn', summary: 'y', findings: [{ title: 'GET /x', severity: 'drift', file: '/abs/api.ts', line: 7 }] }],
  })
);

test('toDiagnosticsMulti: located findings across folders are all surfaced', () => {
  const ds = toDiagnosticsMulti([fa, fb]);
  assert.equal(ds.length, 2);
  assert.equal(ds[0].file, path.join('/work/a', 'src/pay.ts'));
  assert.equal(ds[1].file, '/abs/api.ts');
});

test('findingsForFile: filters to a single file', () => {
  const hits = findingsForFile([fa, fb], path.join('/work/a', 'src/pay.ts'));
  assert.equal(hits.length, 1);
  assert.equal(hits[0].tool, 'aiglare');
});

test('muting: a muted key is dropped from diagnostics', () => {
  const key = findingKey('aiglare', path.join('/work/a', 'src/pay.ts'), 42, 'pay.ts');
  const ds = toDiagnosticsMulti([fa, fb], new Set([key]));
  assert.equal(ds.length, 1);
  assert.equal(ds[0].tool, 'tieline'); // only the un-muted finding remains
});

test('findingKey: stable identity string', () => {
  assert.equal(findingKey('aiglare', '/a/b.ts', 3, 'x'), 'aiglare:/a/b.ts:3:x');
});

test('toDiagnostics: muted set drops the matching finding', () => {
  const v = verdict({ repo: { root: '/r', name: 'r' } });
  const key = findingKey('aiglare', path.join('/r', 'src/pay.ts'), 42, 'pay.ts');
  assert.equal(toDiagnostics(v).length, 1);
  assert.equal(toDiagnostics(v, new Set([key])).length, 0);
});
