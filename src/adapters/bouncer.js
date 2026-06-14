// bouncer — static compliance-controls checker (rule packs).
// Dialect: { findings: [ { ruleId, packId, standard, severity, surface, status } ] }
//   status: pass    — required control found
//           fail    — required control missing
//           unknown — surface not locatable; explicitly NOT a pass
// No findings at all means no packs are configured for this repo → skipped.

import { STATUS, MAX_FINDINGS } from '../verdict.js';

export default {
  tool: 'bouncer',
  pkg: '@nugehs/bouncer',
  binRel: 'src/cli.js',
  binName: 'bouncer',
  domain: 'compliance-controls',
  label: 'Compliance',

  args() {
    return ['check', '--json'];
  },

  skip(res) {
    if (/no\s+\S*config(?:\.json)?\s+found/i.test(`${res.stdout}\n${res.stderr}`)) {
      return 'not configured (run `bouncer init`)';
    }
    return null;
  },

  normalize(json) {
    const findings = Array.isArray(json.findings) ? json.findings : [];
    if (findings.length === 0) {
      return {
        status: STATUS.SKIPPED,
        summary: 'no rule packs configured',
        counts: { rules: 0, pass: 0, fail: 0, unknown: 0 },
        findings: [],
      };
    }

    const fail = findings.filter((f) => f.status === 'fail');
    const unknown = findings.filter((f) => f.status === 'unknown');
    const pass = findings.filter((f) => f.status === 'pass');

    let status;
    if (fail.length > 0) status = STATUS.FAIL;
    else if (unknown.length > 0) status = STATUS.UNKNOWN;
    else status = STATUS.PASS;

    const parts = [`${pass.length}/${findings.length} controls present`];
    if (fail.length > 0) parts.push(`${fail.length} missing`);
    if (unknown.length > 0) parts.push(`${unknown.length} unverifiable`);

    return {
      status,
      summary: parts.join(', '),
      counts: { rules: findings.length, pass: pass.length, fail: fail.length, unknown: unknown.length },
      findings: [...fail, ...unknown].slice(0, MAX_FINDINGS).map((f) => ({
        id: f.ruleId,
        severity: f.severity,
        title: f.standard,
        surface: f.surface,
        status: f.status,
      })),
    };
  },
};
