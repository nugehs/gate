// Engine bridge + pure presentation helpers. This module never imports `vscode`,
// so its logic is unit-testable with plain node:test against the compiled output.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import * as path from 'node:path';

export type Status = 'pass' | 'warn' | 'fail' | 'unknown' | 'skipped' | 'error';

export interface Finding {
  id?: string;
  severity?: string;
  title?: string;
  file?: string;
  line?: number;
  [key: string]: unknown;
}

export interface DomainResult {
  tool: string;
  domain: string;
  label: string;
  status: Status;
  summary: string;
  counts?: Record<string, number>;
  findings?: Finding[];
}

export interface Verdict {
  schemaVersion: number;
  tool: string;
  generatedAt: string;
  repo: { root: string; name: string };
  verdict: 'pass' | 'warn' | 'fail';
  ok: boolean;
  summary: Record<string, number>;
  gate: { ci: boolean; strict: boolean; failed: boolean; nothingChecked?: boolean; reasons: string[] };
  domains: DomainResult[];
}

export interface GateInvocation {
  command: string;
  args: string[];
}

export interface ResolveOptions {
  configuredPath?: string;
  workspaceRoot: string;
}

/**
 * Decide how to invoke gate. Pure + synchronous so it is unit-testable.
 * Order: explicit path → workspace node_modules/.bin → `gate` on PATH
 * (the runner falls back to `npx @nugehs/gate` if that is missing).
 */
export function resolveGate({ configuredPath, workspaceRoot }: ResolveOptions): GateInvocation {
  if (configuredPath) {
    return configuredPath.endsWith('.js')
      ? { command: process.execPath, args: [configuredPath] }
      : { command: configuredPath, args: [] };
  }
  const local = path.join(workspaceRoot, 'node_modules', '.bin', 'gate');
  if (existsSync(local)) {
    return { command: local, args: [] };
  }
  return { command: 'gate', args: [] };
}

export interface RunOptions {
  workspaceRoot: string;
  configuredPath?: string;
  only?: string[];
  skip?: string[];
  /** Treat WARN/UNKNOWN as blocking too (passes --strict to the engine). */
  strict?: boolean;
  /** Abort the run (kills the child) when a newer check supersedes this one. */
  signal?: AbortSignal;
}

function exec(
  command: string,
  args: string[],
  cwd: string,
  signal?: AbortSignal
): Promise<{ stdout: string; stderr: string; error?: NodeJS.ErrnoException }> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 180_000, signal }, (error, stdout, stderr) => {
      resolve({ stdout, stderr, error: (error as NodeJS.ErrnoException) || undefined });
    });
  });
}

function selectionArgs(only?: string[], skip?: string[]): string[] {
  const args: string[] = [];
  if (only && only.length) args.push('--only', only.join(','));
  if (skip && skip.length) args.push('--skip', skip.join(','));
  return args;
}

/** Run gate against a workspace and parse its unified verdict. */
export async function runGate(opts: RunOptions): Promise<Verdict> {
  const inv = resolveGate(opts);
  const tail = [
    opts.workspaceRoot,
    '--json',
    ...selectionArgs(opts.only, opts.skip),
    ...(opts.strict ? ['--strict'] : []),
  ];

  let res = await exec(inv.command, [...inv.args, ...tail], opts.workspaceRoot, opts.signal);
  if (res.error?.code === 'ENOENT' && inv.command === 'gate') {
    // No local or global gate — fall back to the published package via npx.
    res = await exec('npx', ['--yes', '@nugehs/gate', ...tail], opts.workspaceRoot, opts.signal);
  }
  // A superseded run shows up here as an AbortError; surface it as a cancellation
  // the caller can distinguish from a real failure rather than "no output".
  if (opts.signal?.aborted) throw new Error('gate run cancelled');
  if (res.error?.code === 'ENOENT') {
    throw new Error('Could not run gate. Install it (`npm i -g @nugehs/gate`) or set "gate.path".');
  }
  const verdict = parseVerdict(res.stdout);
  if (!verdict) {
    const hint = res.stderr ? `: ${res.stderr.trim().split('\n')[0]}` : '';
    throw new Error(`gate produced no parseable output${hint}`);
  }
  return verdict;
}

/** Tolerant JSON parse — recover the outermost object if a banner leaks in. */
export function parseVerdict(stdout: string): Verdict | null {
  if (!stdout) return null;
  try {
    return JSON.parse(stdout) as Verdict;
  } catch {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(stdout.slice(start, end + 1)) as Verdict;
    } catch {
      return null;
    }
  }
}

// ---- Pure presentation helpers (no vscode import) ----

const VERDICT_ICON: Record<'pass' | 'warn' | 'fail', string> = {
  pass: '$(pass)',
  warn: '$(warning)',
  fail: '$(error)',
};

export function statusBarText(v: Verdict | null, running: boolean): { text: string; tooltip: string } {
  if (running) return { text: '$(sync~spin) gate', tooltip: 'gate: running…' };
  if (!v) return { text: '$(circle-outline) gate', tooltip: 'gate: not run yet — click to check' };
  if (v.gate?.nothingChecked) {
    return {
      text: '$(question) gate: nothing checked',
      tooltip: ['gate: no checks ran', ...(v.gate.reasons ?? [])].join('\n'),
    };
  }
  const text = `${VERDICT_ICON[v.verdict]} gate: ${v.verdict.toUpperCase()}`;
  const lines = v.domains.map((d) => `${d.label}: ${d.status}${d.summary ? ' — ' + d.summary : ''}`);
  const tooltip = [`gate · ${v.repo.name}`, '', ...lines].join('\n');
  return { text, tooltip };
}

export interface TreeNode {
  label: string;
  description?: string;
  status?: Status;
  tooltip?: string;
  file?: string;
  line?: number;
  children?: TreeNode[];
}

function resolveFile(file: string, root: string): string {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

export function toTree(v: Verdict | null): TreeNode[] {
  if (!v) return [{ label: 'Run gate to see the verdict' }];
  return v.domains.map((d) => ({
    label: d.label,
    description: `${d.status}${d.summary ? ' · ' + d.summary : ''}`,
    status: d.status,
    tooltip: d.summary,
    children: (d.findings ?? []).map((f) => ({
      label: String(f.title ?? f.id ?? 'finding'),
      description: f.severity ? String(f.severity) : undefined,
      status: d.status,
      tooltip: f.id ? String(f.id) : undefined,
      file: typeof f.file === 'string' ? resolveFile(f.file, v.repo.root) : undefined,
      line: typeof f.line === 'number' ? f.line : undefined,
    })),
  }));
}

export interface DiagDescriptor {
  file: string; // absolute path
  line: number; // 1-based
  severity: Status;
  message: string;
  source: string; // `gate/<tool>`
  tool: string; // the originating tool (aiglare, tieline, …)
  title: string; // the finding's human label
  key: string; // stable identity, used to mute a specific finding
}

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

/** Stable identity for a single located finding — used to mute it in the editor. */
export function findingKey(tool: string, file: string, line: number, title: string): string {
  return `${tool}:${file}:${line}:${title}`;
}

/**
 * Flatten a verdict's located findings into diagnostic descriptors (vscode-free).
 * `muted` keys (see {@link findingKey}) are dropped so a user can silence a
 * specific finding without touching the engine.
 */
export function toDiagnostics(v: Verdict | null, muted: ReadonlySet<string> = EMPTY_SET): DiagDescriptor[] {
  if (!v) return [];
  const out: DiagDescriptor[] = [];
  for (const d of v.domains) {
    for (const f of d.findings ?? []) {
      if (typeof f.file !== 'string' || !f.file) continue;
      const file = resolveFile(f.file, v.repo.root);
      const line = typeof f.line === 'number' && f.line > 0 ? f.line : 1;
      const title = String(f.title ?? f.id ?? 'finding');
      const key = findingKey(d.tool, file, line, title);
      if (muted.has(key)) continue;
      out.push({
        file,
        line,
        severity: d.status,
        message: `${d.label}: ${title}${f.severity ? ` (${f.severity})` : ''}`,
        source: `gate/${d.tool}`,
        tool: d.tool,
        title,
        key,
      });
    }
  }
  return out;
}

// ---- Multi-root workspace aggregation ----

export interface FolderResult {
  folder: string; // absolute fsPath of the workspace folder
  name: string; // display name (folder basename)
  verdict: Verdict | null; // null when the run failed for this folder
  error?: string; // populated when the run failed
}

const STATUS_RANK: Record<string, number> = {
  pass: 0,
  skipped: 0,
  warn: 2,
  unknown: 2,
  error: 2,
  fail: 3,
};

export type Overall = 'pass' | 'warn' | 'fail' | 'none';

const OVERALL_ICON: Record<Overall, string> = {
  pass: '$(pass)',
  warn: '$(warning)',
  fail: '$(error)',
  none: '$(circle-outline)',
};

function folderSummary(r: FolderResult): string {
  if (r.error) return `error — ${r.error}`;
  const v = r.verdict;
  if (!v) return 'not run';
  if (v.gate?.nothingChecked) return 'nothing checked';
  return v.verdict.toUpperCase();
}

/** Worst verdict across every folder. A failed/empty/unchecked run counts as warn, never pass. */
export function overallStatus(results: FolderResult[]): Overall {
  if (results.length === 0) return 'none';
  let rank = 0;
  for (const r of results) {
    if (r.error || !r.verdict || r.verdict.gate?.nothingChecked) {
      rank = Math.max(rank, 2);
      continue;
    }
    rank = Math.max(rank, STATUS_RANK[r.verdict.verdict] ?? 2);
  }
  return rank >= 3 ? 'fail' : rank >= 2 ? 'warn' : 'pass';
}

/** Status-bar text across N folders. One folder = the existing single-verdict view. */
export function statusBarTextMulti(results: FolderResult[], running: boolean): { text: string; tooltip: string } {
  if (running) return { text: '$(sync~spin) gate', tooltip: 'gate: running…' };
  if (results.length === 0) return { text: '$(circle-outline) gate', tooltip: 'gate: not run yet — click to check' };
  if (results.length === 1) return statusBarText(results[0].verdict, false);
  const overall = overallStatus(results);
  const text = `${OVERALL_ICON[overall]} gate: ${overall.toUpperCase()} · ${results.length} folders`;
  const lines = results.map((r) => `${r.name}: ${folderSummary(r)}`);
  return { text, tooltip: [`gate · ${results.length} folders`, '', ...lines].join('\n') };
}

/** Tree across N folders. One folder = domains at the root; many = a folder layer on top. */
export function toTreeMulti(results: FolderResult[]): TreeNode[] {
  if (results.length === 0) return [{ label: 'Run gate to see the verdict' }];
  if (results.length === 1) return toTree(results[0].verdict);
  return results.map((r) => ({
    label: r.name,
    description: folderSummary(r).toLowerCase(),
    status: r.error ? ('error' as Status) : (r.verdict?.verdict as Status | undefined),
    tooltip: r.folder,
    children: r.error ? [{ label: r.error }] : toTree(r.verdict),
  }));
}

/** All located diagnostics across every folder, minus muted ones. */
export function toDiagnosticsMulti(results: FolderResult[], muted: ReadonlySet<string> = EMPTY_SET): DiagDescriptor[] {
  return results.flatMap((r) => toDiagnostics(r.verdict, muted));
}

/** Located findings for a single file (powers hovers, code actions and CodeLens). */
export function findingsForFile(
  results: FolderResult[],
  fsPath: string,
  muted: ReadonlySet<string> = EMPTY_SET
): DiagDescriptor[] {
  return toDiagnosticsMulti(results, muted).filter((d) => d.file === fsPath);
}

const TOOL_DOCS: Record<string, string> = {
  aiglare: 'https://www.npmjs.com/package/@nugehs/aiglare',
  bouncer: 'https://www.npmjs.com/package/@nugehs/bouncer',
  tieline: 'https://www.npmjs.com/package/@nugehs/tieline',
  repoctx: 'https://www.npmjs.com/package/@nugehs/repoctx',
};

/** The docs URL for a tool, for the "open rule" code action. */
export function toolDocsUrl(tool: string): string {
  return TOOL_DOCS[tool] ?? 'https://github.com/nugehs/gate#readme';
}

// ---- Editor-facing accessors (implemented by the extension host) ----

/** Read-only view of the latest run — shared with the providers and the cockpit. */
export interface GateView {
  results(): FolderResult[];
  muted(): ReadonlySet<string>;
  overall(): Overall;
}

export interface RunRequest {
  only?: string[];
  skip?: string[];
  strict?: boolean;
  signal?: AbortSignal;
}

/** Runs gate across the whole workspace (every folder) and returns per-folder results. */
export interface GateRunner {
  run(req: RunRequest): Promise<FolderResult[]>;
}
