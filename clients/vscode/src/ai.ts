// Tier 0 — make the AI assistant itself gated. Three editor AI surfaces, all
// backed by the same unified verdict:
//   • Language Model Tool   — agent mode can call `gate_check` before it says "done"
//   • Chat participant      — `@gate can this ship?` / `@gate /why`
//   • MCP server provider   — registers gate's own MCP server with the editor
//
// Every entry point is feature-detected, so the extension still loads on an
// editor/fork that doesn't implement a given API (e.g. older Cursor builds).

import * as vscode from 'vscode';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { overallStatus, type GateRunner, type FolderResult } from './gate';

interface GateToolInput {
  only?: string[];
  skip?: string[];
  strict?: boolean;
}

export function registerAi(
  context: vscode.ExtensionContext,
  runner: GateRunner,
  workspaceRoot: () => string | undefined,
  configuredPath: () => string | undefined
): void {
  registerTool(context, runner);
  registerParticipant(context, runner);
  registerMcp(context, workspaceRoot, configuredPath);
}

// ---- Agent tool ----

function registerTool(context: vscode.ExtensionContext, runner: GateRunner): void {
  if (typeof vscode.lm?.registerTool !== 'function') return;

  const tool: vscode.LanguageModelTool<GateToolInput> = {
    async invoke(options, token) {
      const input = options.input ?? {};
      const ac = new AbortController();
      token.onCancellationRequested(() => ac.abort());
      const results = await runner.run({ only: input.only, skip: input.skip, strict: input.strict, signal: ac.signal });
      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(formatForModel(results))]);
    },
    prepareInvocation() {
      return { invocationMessage: 'Running gate…' };
    },
  };

  context.subscriptions.push(vscode.lm.registerTool('gate_check', tool));
}

// ---- Chat participant ----

function registerParticipant(context: vscode.ExtensionContext, runner: GateRunner): void {
  if (typeof vscode.chat?.createChatParticipant !== 'function') return;

  const handler: vscode.ChatRequestHandler = async (request, _ctxt, stream, token) => {
    stream.progress('Running gate…');
    const ac = new AbortController();
    token.onCancellationRequested(() => ac.abort());

    let results: FolderResult[];
    try {
      results = await runner.run({ signal: ac.signal });
    } catch (err) {
      stream.markdown(`Could not run gate: ${err instanceof Error ? err.message : String(err)}`);
      return {};
    }

    renderChat(stream, results, request.command);
    return {};
  };

  const participant = vscode.chat.createChatParticipant('nugehs.gate', handler);
  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, 'media', 'gate.svg');
  context.subscriptions.push(participant);
}

function renderChat(stream: vscode.ChatResponseStream, results: FolderResult[], command?: string): void {
  const overall = overallStatus(results);
  stream.markdown(`### ${mark(overall)} gate: **${overall.toUpperCase()}**\n\n`);

  for (const r of results) {
    if (results.length > 1) stream.markdown(`#### ${r.name}\n\n`);
    if (r.error) {
      stream.markdown(`- could not run: ${r.error}\n`);
      continue;
    }
    const v = r.verdict;
    if (!v) continue;
    for (const d of v.domains) {
      stream.markdown(`- ${mark(d.status)} **${d.label}** — ${d.status}${d.summary ? ` · ${d.summary}` : ''}\n`);
    }
    const reasons = v.gate?.reasons ?? [];
    if (reasons.length) {
      stream.markdown(`\n**Blocking reasons:**\n`);
      for (const x of reasons) stream.markdown(`- ${x}\n`);
    }
  }

  stream.markdown(`\n${command === 'why' ? whyGuidance(overall) : verdictLine(overall)}\n`);
  stream.button({ command: 'gate.focusCockpit', title: 'Open verdict cockpit' });
}

// ---- MCP server provider ----

function registerMcp(
  context: vscode.ExtensionContext,
  workspaceRoot: () => string | undefined,
  configuredPath: () => string | undefined
): void {
  if (typeof vscode.lm?.registerMcpServerDefinitionProvider !== 'function') return;

  const provider: vscode.McpServerDefinitionProvider = {
    provideMcpServerDefinitions() {
      const { command, args } = mcpCommand(workspaceRoot(), configuredPath());
      return [new vscode.McpStdioServerDefinition('gate', command, args)];
    },
  };

  try {
    context.subscriptions.push(vscode.lm.registerMcpServerDefinitionProvider('nugehs-gate', provider));
  } catch {
    // API present in types but not implemented on this host — skip silently.
  }
}

function mcpCommand(root: string | undefined, configured: string | undefined): { command: string; args: string[] } {
  if (configured) {
    return configured.endsWith('.js')
      ? { command: process.execPath, args: [configured, 'mcp'] }
      : { command: configured, args: ['mcp'] };
  }
  if (root) {
    const local = path.join(root, 'node_modules', '.bin', 'gate');
    if (existsSync(local)) return { command: local, args: ['mcp'] };
  }
  return { command: 'npx', args: ['--yes', '@nugehs/gate', 'mcp'] };
}

// ---- Shared formatting ----

function mark(status: string): string {
  if (status === 'fail' || status === 'error') return '✗';
  if (status === 'warn' || status === 'unknown') return '⚠';
  if (status === 'pass') return '✓';
  return '·';
}

function verdictLine(overall: string): string {
  switch (overall) {
    case 'fail':
      return 'A blocking problem was found — resolve the reasons above before shipping.';
    case 'warn':
      return 'Shippable, but with warnings worth a look.';
    case 'pass':
      return 'Clean — every check that ran passed.';
    default:
      return 'No checks ran for this workspace.';
  }
}

function whyGuidance(overall: string): string {
  switch (overall) {
    case 'fail':
      return 'Each blocking reason names the tool and the failing check. Fix those (an aiglare red surface on a side-effectful sink, a tieline drift, a missing bouncer control, or a repoctx merge gate) and re-run gate.';
    case 'warn':
      return 'Warnings do not block by default. Review them, or enable `gate.strict` to treat them as blocking.';
    case 'pass':
      return 'Nothing is blocking. Every check that applied to this repo passed.';
    default:
      return 'No domain actually ran — every check was skipped or deselected. Configure at least one tool (e.g. `bouncer init`, `tieline init`).';
  }
}

/** Plain-text verdict the model can act on — explicit "do not ship" on a fail. */
function formatForModel(results: FolderResult[]): string {
  const overall = overallStatus(results);
  const lines: string[] = [`gate verdict: ${overall.toUpperCase()}`];

  for (const r of results) {
    const head = results.length > 1 ? `[${r.name}] ` : '';
    if (r.error) {
      lines.push(`${head}error — ${r.error}`);
      continue;
    }
    const v = r.verdict;
    if (!v) {
      lines.push(`${head}not run`);
      continue;
    }
    if (v.gate?.nothingChecked) lines.push(`${head}NO CHECKS RAN — ${(v.gate.reasons ?? []).join('; ')}`);
    for (const d of v.domains) lines.push(`${head}${d.label}: ${d.status}${d.summary ? ' — ' + d.summary : ''}`);
    for (const reason of v.gate?.reasons ?? []) lines.push(`${head}BLOCKING: ${reason}`);
  }

  lines.push('');
  lines.push(
    overall === 'fail'
      ? 'Do not ship: at least one blocking problem was found. Resolve the BLOCKING items above before merging.'
      : overall === 'warn'
        ? 'Shippable, but with warnings worth a look.'
        : overall === 'pass'
          ? 'Clean: every check that ran passed.'
          : 'No checks ran for this workspace.'
  );
  return lines.join('\n');
}
