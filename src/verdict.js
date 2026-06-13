// The unified verdict model.
//
// Every tool speaks its own dialect — aiglare has red/amber/green, bouncer has
// pass/fail/unknown, tieline has matched/drift, repoctx has PASS/WARN/FAIL.
// Adapters normalize each into a single STATUS. This module rolls a set of
// per-domain results up into one verdict and decides whether the gate fails.

/** The normalized status vocabulary every adapter maps onto. */
export const STATUS = Object.freeze({
  PASS: 'pass', // the check ran and is clean
  WARN: 'warn', // ran, found something worth a look, not blocking
  FAIL: 'fail', // ran, found a blocking problem
  UNKNOWN: 'unknown', // ran, but could not determine — explicitly "not a pass"
  SKIPPED: 'skipped', // not applicable / not configured for this repo
  ERROR: 'error', // the tool could not be run or returned garbage
});

// How bad each status is when rolling up. SKIPPED is invisible to the verdict;
// UNKNOWN and ERROR sit at WARN level so they never silently pass.
const RANK = Object.freeze({
  pass: 0,
  skipped: 0,
  unknown: 2,
  warn: 2,
  error: 2,
  fail: 3,
});

function statusForRank(rank) {
  if (rank >= 3) return STATUS.FAIL;
  if (rank >= 2) return STATUS.WARN;
  return STATUS.PASS;
}

/**
 * Roll per-domain results into one verdict.
 *
 * @param {Array<{tool:string,label:string,status:string,summary:string}>} domains
 * @param {{ci?:boolean, strict?:boolean}} opts
 *   ci     — when true, a blocking verdict sets gate.failed (drives a non-zero exit)
 *   strict — when true, WARN-level results also block (otherwise only FAIL blocks)
 */
export function mergeVerdict(domains, { ci = false, strict = false } = {}) {
  const counts = {
    domains: domains.length,
    pass: 0,
    warn: 0,
    fail: 0,
    unknown: 0,
    skipped: 0,
    error: 0,
  };
  for (const d of domains) {
    if (counts[d.status] === undefined) counts[d.status] = 0;
    counts[d.status] += 1;
  }

  // SKIPPED domains do not influence the verdict — the check simply did not apply.
  const ran = domains.filter((d) => d.status !== STATUS.SKIPPED);
  const nothingChecked = ran.length === 0;
  let rank = 0;
  for (const d of ran) rank = Math.max(rank, RANK[d.status] ?? 0);
  const verdict = statusForRank(rank);

  const blocks = (d) =>
    d.status === STATUS.FAIL ||
    (strict && (d.status === STATUS.WARN || d.status === STATUS.UNKNOWN || d.status === STATUS.ERROR));

  const reasons = domains.filter(blocks).map((d) => `${d.label}: ${d.summary}`);
  // A gate that checked nothing must not read as a clean pass — that's how a
  // typo (`--skip` everything, a bare trailing `--only`) silently defeats CI.
  if (nothingChecked) reasons.unshift('no checks ran — every domain was skipped or deselected');

  const failed = ci && (verdict === STATUS.FAIL || nothingChecked || (strict && verdict === STATUS.WARN));
  counts.ran = ran.length;

  return {
    verdict,
    ok: verdict !== STATUS.FAIL && !nothingChecked,
    summary: counts,
    gate: { ci, strict, failed, nothingChecked, reasons },
  };
}
