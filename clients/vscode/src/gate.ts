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
}

function exec(
  command: string,
  args: string[],
  cwd: string
): Promise<{ stdout: string; stderr: string; error?: NodeJS.ErrnoException }> {
  return new Promise((resolve) => {
    execFile(command, args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 180_000 }, (error, stdout, stderr) => {
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
  const tail = [opts.workspaceRoot, '--json', ...selectionArgs(opts.only, opts.skip)];

  let res = await exec(inv.command, [...inv.args, ...tail], opts.workspaceRoot);
  if (res.error?.code === 'ENOENT' && inv.command === 'gate') {
    // No local or global gate — fall back to the published package via npx.
    res = await exec('npx', ['--yes', '@nugehs/gate', ...tail], opts.workspaceRoot);
  }
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
  children?: TreeNode[];
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
      file: typeof f.file === 'string' ? f.file : undefined,
    })),
  }));
}
