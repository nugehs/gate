// Run the selected adapters against a repo, in parallel, and merge their
// per-domain results into one unified verdict.

import path from 'node:path';
import { ADAPTERS } from './adapters/index.js';
import { resolveTool } from './resolve.js';
import { runTool, extractJson } from './run.js';
import { mergeVerdict, STATUS } from './verdict.js';

const SCHEMA_VERSION = 1;

export async function runAdapter(adapter, ctx) {
  const base = { tool: adapter.tool, domain: adapter.domain, label: adapter.label };

  const resolved = resolveTool(adapter);
  if (!resolved) {
    return {
      ...base,
      status: STATUS.SKIPPED,
      summary: `${adapter.tool} not installed`,
      counts: {},
      findings: [],
      available: false,
      source: null,
      durationMs: 0,
      exitCode: null,
      error: `Could not resolve ${adapter.pkg}. Install it, or set GATE_${adapter.tool.toUpperCase()}_BIN.`,
    };
  }

  const startedAt = Date.now();
  const res = await runTool(resolved.entry, adapter.args(ctx), { cwd: ctx.path });
  const durationMs = Date.now() - startedAt;
  const meta = { available: true, source: resolved.source, durationMs, exitCode: res.exitCode };

  if (res.spawnError || res.timedOut) {
    return {
      ...base,
      ...meta,
      status: STATUS.ERROR,
      summary: res.timedOut ? 'timed out' : 'failed to run',
      counts: {},
      findings: [],
      error: res.spawnError ?? 'timed out',
    };
  }

  // A tool that isn't configured for this repo (no config file, not a git repo)
  // is "not applicable" — skip it rather than treating it as an error.
  const skipReason = adapter.skip?.(res);
  if (skipReason) {
    return {
      ...base,
      ...meta,
      status: STATUS.SKIPPED,
      summary: skipReason,
      counts: {},
      findings: [],
      error: null,
    };
  }

  const json = extractJson(res.stdout);
  if (!json) {
    return {
      ...base,
      ...meta,
      status: STATUS.ERROR,
      summary: 'no parseable output',
      counts: {},
      findings: [],
      error: (res.stderr || res.stdout || '').trim().split('\n').slice(0, 3).join(' ') || 'empty output',
    };
  }

  try {
    const norm = adapter.normalize(json);
    return { ...base, ...meta, error: null, ...norm };
  } catch (e) {
    return {
      ...base,
      ...meta,
      status: STATUS.ERROR,
      summary: 'could not interpret output',
      counts: {},
      findings: [],
      error: String(e?.message ?? e),
    };
  }
}

/**
 * @param {{path?:string, only?:string[]|null, skip?:string[], ci?:boolean, strict?:boolean}} opts
 */
export async function runGate(opts = {}) {
  const target = path.resolve(opts.path ?? process.cwd());
  const only = opts.only ?? null;
  const skip = opts.skip ?? [];

  const selected = ADAPTERS.filter(
    (a) => (!only || only.includes(a.tool)) && !skip.includes(a.tool)
  );

  const ctx = { path: target };
  const domains = await Promise.all(selected.map((a) => runAdapter(a, ctx)));

  const merged = mergeVerdict(domains, { ci: opts.ci, strict: opts.strict });

  return {
    schemaVersion: SCHEMA_VERSION,
    tool: 'gate',
    generatedAt: new Date().toISOString(),
    repo: { root: target, name: path.basename(target) },
    ...merged,
    domains,
  };
}
