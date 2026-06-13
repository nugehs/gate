// tieline — static frontend↔backend contract-drift checker.
// Dialect: { totals:{matched,drift,unverifiable,dead}, drift:[], unverifiable:[], ... }
//   drift        — FE call resolves but BE has no such route/method (the bug bucket)
//   unverifiable — call shape couldn't be resolved on one side
// All-zero totals means no contract map was built (not configured) → skipped.

import { STATUS } from '../verdict.js';

export default {
  tool: 'tieline',
  pkg: '@nugehs/tieline',
  binRel: 'bin/tieline.mjs',
  binName: 'tieline',
  domain: 'contract-drift',
  label: 'Contract drift',

  args() {
    return ['check', '--json'];
  },

  skip(res) {
    if (/no\s+\S*config(?:\.json)?\s+found/i.test(`${res.stdout}\n${res.stderr}`)) {
      return 'not configured (run `tieline init`)';
    }
    return null;
  },

  normalize(json) {
    const t = json.totals ?? { matched: 0, drift: 0, unverifiable: 0, dead: 0 };
    const empty = !t.matched && !t.drift && !t.unverifiable && !t.dead;
    if (empty) {
      return {
        status: STATUS.SKIPPED,
        summary: 'no contract map (not configured)',
        counts: t,
        findings: [],
      };
    }

    let status;
    if (t.drift > 0) status = STATUS.FAIL;
    else if (t.unverifiable > 0) status = STATUS.WARN;
    else status = STATUS.PASS;

    const parts = [`${t.drift} drift`, `${t.matched} matched`];
    if (t.unverifiable > 0) parts.push(`${t.unverifiable} unverifiable`);

    return {
      status,
      summary: parts.join(' · '),
      counts: t,
      findings: (json.drift ?? []).slice(0, 5).map((d) => ({
        id: `${d.method ?? ''} ${d.path ?? d.url ?? ''}`.trim(),
        severity: 'drift',
        title: d.path ?? d.url ?? d.endpoint,
        method: d.method,
      })),
    };
  },
};
