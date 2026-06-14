// aiglare — AI/LLM governance guardrails.
// Dialect: { ok, surfaceCount, summary:{red,amber,green}, surfaces:[{severity,sink,...}] }
//
// We deliberately do NOT pass --ci: under --ci aiglare calls process.exit(1),
// which truncates its own JSON when stdout is a pipe (the classic Node
// flush-on-exit gotcha). Instead we run it clean (exit 0, full output) and
// derive the blocking verdict ourselves — a red surface on a side-effectful
// sink is the "AI auto-triggers an irreversible action" case.

import { STATUS, MAX_FINDINGS } from '../verdict.js';

const isBlocking = (s) => s.severity === 'red' && s.sink === 'side-effectful';

// aiglare puts line numbers in evidence strings like "file.ts:13 a.create()".
function firstEvidenceLine(evidence) {
  for (const e of evidence ?? []) {
    const m = /:(\d+)\b/.exec(e);
    if (m) return Number(m[1]);
  }
  return undefined;
}

export default {
  tool: 'aiglare',
  pkg: '@nugehs/aiglare',
  binRel: 'src/cli.js',
  binName: 'aiglare',
  domain: 'ai-governance',
  label: 'AI governance',

  args(ctx) {
    return [ctx.path ?? '.', '--format', 'json'];
  },

  normalize(json) {
    const s = json.summary ?? { red: 0, amber: 0, green: 0 };
    const surfaces = json.surfaces ?? [];
    const count = json.surfaceCount ?? surfaces.length;
    const blocking = surfaces.filter(isBlocking);

    if (count === 0) {
      return {
        status: STATUS.PASS,
        summary: 'no AI surfaces detected',
        counts: { surfaces: 0, red: 0, amber: 0, green: 0, blocking: 0 },
        findings: [],
      };
    }

    let status;
    if (blocking.length > 0) status = STATUS.FAIL;
    else if (s.red > 0 || s.amber > 0) status = STATUS.WARN;
    else status = STATUS.PASS;

    const parts = [`${s.red} red`, `${s.amber} amber`, `${s.green} green`];
    if (blocking.length > 0) {
      parts.push(`${blocking.length} blocking side-effect${blocking.length === 1 ? '' : 's'}`);
    }

    const reds = surfaces.filter((x) => x.severity === 'red');
    const ordered = [...blocking, ...reds.filter((x) => !isBlocking(x))];

    return {
      status,
      summary: parts.join(' · '),
      counts: { surfaces: count, red: s.red, amber: s.amber, green: s.green, blocking: blocking.length },
      findings: ordered.slice(0, MAX_FINDINGS).map((x) => ({
        id: x.file,
        severity: 'red',
        title: x.file,
        sink: x.sink,
        file: x.file, // relative to repo root
        line: firstEvidenceLine(x.evidence),
      })),
    };
  },
};
