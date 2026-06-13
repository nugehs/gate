import { test } from 'node:test';
import assert from 'node:assert/strict';
import aiglare from '../src/adapters/aiglare.js';
import bouncer from '../src/adapters/bouncer.js';
import tieline from '../src/adapters/tieline.js';
import repoctx from '../src/adapters/repoctx.js';
import { STATUS } from '../src/verdict.js';

// Fixtures mirror the real --json shapes captured from each tool.

test('aiglare: red surface on a side-effectful sink → FAIL (blocking)', () => {
  const r = aiglare.normalize({
    ok: true,
    surfaceCount: 16,
    summary: { red: 2, amber: 1, green: 13 },
    surfaces: [
      { file: 'pay.ts', severity: 'red', sink: 'side-effectful', evidence: ['pay.ts:42 client.create()'] },
      { file: 'reply.tsx', severity: 'red', sink: 'user-facing' },
    ],
  });
  assert.equal(r.status, STATUS.FAIL);
  assert.match(r.summary, /2 red/);
  assert.match(r.summary, /1 blocking side-effect/);
  assert.equal(r.counts.blocking, 1);
  assert.equal(r.findings[0].id, 'pay.ts'); // blocking surface ordered first
  assert.equal(r.findings[0].file, 'pay.ts'); // enriched for diagnostics
  assert.equal(r.findings[0].line, 42); // parsed from evidence
});

test('aiglare: red but only user-facing → WARN (not blocking)', () => {
  const r = aiglare.normalize({
    surfaceCount: 3,
    summary: { red: 1, amber: 1, green: 1 },
    surfaces: [{ file: 'a.tsx', severity: 'red', sink: 'user-facing' }],
  });
  assert.equal(r.status, STATUS.WARN);
  assert.equal(r.counts.blocking, 0);
});

test('aiglare: amber only → WARN', () => {
  const r = aiglare.normalize({ surfaceCount: 4, summary: { red: 0, amber: 2, green: 2 }, surfaces: [] });
  assert.equal(r.status, STATUS.WARN);
});

test('aiglare: no surfaces → PASS', () => {
  const r = aiglare.normalize({ surfaceCount: 0, summary: { red: 0, amber: 0, green: 0 }, surfaces: [] });
  assert.equal(r.status, STATUS.PASS);
  assert.match(r.summary, /no AI surfaces/);
});

test('bouncer: a missing control → FAIL', () => {
  const r = bouncer.normalize({
    findings: [
      { ruleId: 'osa.age', status: 'fail', severity: 'high', standard: 'Age assurance', surface: 'signup' },
      { ruleId: 'osa.report', status: 'pass', severity: 'high', standard: 'Reporting' },
    ],
  });
  assert.equal(r.status, STATUS.FAIL);
  assert.equal(r.counts.fail, 1);
  assert.equal(r.findings[0].id, 'osa.age');
});

test('bouncer: only unknowns → UNKNOWN (not pass)', () => {
  const r = bouncer.normalize({ findings: [{ ruleId: 'x', status: 'unknown', standard: 'y' }] });
  assert.equal(r.status, STATUS.UNKNOWN);
});

test('bouncer: no findings → SKIPPED', () => {
  assert.equal(bouncer.normalize({ findings: [] }).status, STATUS.SKIPPED);
});

test('tieline: drift → FAIL', () => {
  const r = tieline.normalize({
    totals: { matched: 12, drift: 2, unverifiable: 0, dead: 1 },
    drift: [{ method: 'GET', path: '/api/users/:id', file: '/abs/src/api.ts', line: 160 }],
  });
  assert.equal(r.status, STATUS.FAIL);
  assert.match(r.summary, /2 drift/);
  assert.equal(r.findings[0].method, 'GET');
  assert.equal(r.findings[0].file, '/abs/src/api.ts'); // enriched for diagnostics
  assert.equal(r.findings[0].line, 160);
});

test('tieline: only unverifiable → WARN', () => {
  assert.equal(tieline.normalize({ totals: { matched: 5, drift: 0, unverifiable: 3, dead: 0 } }).status, STATUS.WARN);
});

test('tieline: configured-but-empty totals → WARN (never "not configured")', () => {
  // normalize() is only reached when tieline ran cleanly (genuine no-config is
  // caught by skip()), so all-zero totals mean a stale/empty config, not absence.
  const r = tieline.normalize({ totals: { matched: 0, drift: 0, unverifiable: 0, dead: 0 } });
  assert.equal(r.status, STATUS.WARN);
  assert.doesNotMatch(r.summary, /not configured/);
  assert.match(r.summary, /empty|resolved/i);
});

test('repoctx: WARN verdict maps to WARN', () => {
  const r = repoctx.normalize({
    verdict: 'WARN',
    checks: [
      { name: 'Secret safety', status: 'PASS', summary: 'ok' },
      { name: 'Risk review', status: 'WARN', summary: 'risky path changed' },
    ],
  });
  assert.equal(r.status, STATUS.WARN);
  assert.equal(r.counts.failing, 1);
  assert.equal(r.findings[0].id, 'Risk review');
});

test('repoctx: PASS verdict maps to PASS', () => {
  assert.equal(repoctx.normalize({ verdict: 'PASS', checks: [{ name: 'a', status: 'PASS' }] }).status, STATUS.PASS);
});

test('repoctx: FAIL/BLOCK verdict maps to FAIL', () => {
  assert.equal(repoctx.normalize({ verdict: 'FAIL', checks: [] }).status, STATUS.FAIL);
  assert.equal(repoctx.normalize({ verdict: 'BLOCK', checks: [] }).status, STATUS.FAIL);
});
