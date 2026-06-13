import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeVerdict, STATUS } from '../src/verdict.js';

const dom = (label, status, summary = '') => ({ tool: label, label, status, summary });

test('all pass → PASS, ok', () => {
  const r = mergeVerdict([dom('a', STATUS.PASS), dom('b', STATUS.PASS)]);
  assert.equal(r.verdict, 'pass');
  assert.equal(r.ok, true);
  assert.equal(r.gate.failed, false);
});

test('any fail → FAIL, not ok', () => {
  const r = mergeVerdict([dom('a', STATUS.PASS), dom('b', STATUS.FAIL)]);
  assert.equal(r.verdict, 'fail');
  assert.equal(r.ok, false);
});

test('warn dominates pass but not fail', () => {
  assert.equal(mergeVerdict([dom('a', STATUS.WARN), dom('b', STATUS.PASS)]).verdict, 'warn');
  assert.equal(mergeVerdict([dom('a', STATUS.WARN), dom('b', STATUS.FAIL)]).verdict, 'fail');
});

test('unknown rolls up to warn (never a silent pass)', () => {
  assert.equal(mergeVerdict([dom('a', STATUS.UNKNOWN), dom('b', STATUS.PASS)]).verdict, 'warn');
});

test('error rolls up to warn', () => {
  assert.equal(mergeVerdict([dom('a', STATUS.ERROR), dom('b', STATUS.PASS)]).verdict, 'warn');
});

test('skipped is invisible to the verdict', () => {
  const r = mergeVerdict([dom('a', STATUS.SKIPPED), dom('b', STATUS.PASS)]);
  assert.equal(r.verdict, 'pass');
  assert.equal(r.summary.skipped, 1);
});

test('all skipped → PASS (nothing applied)', () => {
  assert.equal(mergeVerdict([dom('a', STATUS.SKIPPED), dom('b', STATUS.SKIPPED)]).verdict, 'pass');
});

test('--ci sets gate.failed only on FAIL by default', () => {
  assert.equal(mergeVerdict([dom('a', STATUS.WARN)], { ci: true }).gate.failed, false);
  assert.equal(mergeVerdict([dom('a', STATUS.FAIL)], { ci: true }).gate.failed, true);
});

test('--strict makes WARN block under --ci', () => {
  const r = mergeVerdict([dom('a', STATUS.WARN, 'drift')], { ci: true, strict: true });
  assert.equal(r.gate.failed, true);
  assert.deepEqual(r.gate.reasons, ['a: drift']);
});

test('reasons list every blocking domain', () => {
  const r = mergeVerdict([dom('AI', STATUS.FAIL, 'red'), dom('B', STATUS.PASS), dom('C', STATUS.FAIL, 'missing')], { ci: true });
  assert.deepEqual(r.gate.reasons, ['AI: red', 'C: missing']);
});

test('counts tally every status bucket', () => {
  const r = mergeVerdict([dom('a', STATUS.PASS), dom('b', STATUS.FAIL), dom('c', STATUS.SKIPPED), dom('d', STATUS.WARN)]);
  assert.equal(r.summary.domains, 4);
  assert.equal(r.summary.pass, 1);
  assert.equal(r.summary.fail, 1);
  assert.equal(r.summary.skipped, 1);
  assert.equal(r.summary.warn, 1);
});
