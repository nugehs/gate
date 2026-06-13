// repoctx — deterministic merge-readiness gate.
// Dialect: { verdict: 'PASS'|'WARN'|'FAIL', checks: [ { name, status, summary } ] }
// This is the merge spine the other three feed; its verdict maps directly.

import { STATUS } from '../verdict.js';

export default {
  tool: 'repoctx',
  pkg: '@nugehs/repoctx',
  binRel: 'src/cli.js',
  binName: 'repoctx',
  domain: 'merge-readiness',
  label: 'Merge readiness',

  args() {
    return ['gate', '--json'];
  },

  skip(res) {
    if (/not a git repos/i.test(`${res.stdout}\n${res.stderr}`)) {
      return 'not a git repository';
    }
    return null;
  },

  normalize(json) {
    const checks = Array.isArray(json.checks) ? json.checks : [];
    const failing = checks.filter((c) => String(c.status).toUpperCase() !== 'PASS');
    const v = String(json.verdict ?? '').toUpperCase();

    let status;
    if (v === 'PASS') status = STATUS.PASS;
    else if (v === 'WARN') status = STATUS.WARN;
    else if (v) status = STATUS.FAIL; // FAIL / BLOCK / anything blocking
    else status = STATUS.UNKNOWN;

    const summary =
      failing.length > 0
        ? `${failing.length} of ${checks.length} checks need attention`
        : `${checks.length} checks passed`;

    return {
      status,
      summary,
      counts: { checks: checks.length, failing: failing.length },
      findings: failing.slice(0, 5).map((c) => ({
        id: c.name,
        severity: String(c.status).toLowerCase(),
        title: c.summary,
      })),
    };
  },
};
