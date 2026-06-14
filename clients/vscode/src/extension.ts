import * as vscode from 'vscode';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import {
  runGate,
  statusBarTextMulti,
  toTreeMulti,
  toDiagnosticsMulti,
  toolDocsUrl,
  overallStatus,
  type TreeNode,
  type FolderResult,
  type Status,
  type GateView,
  type GateRunner,
  type RunRequest,
} from './gate';
import { registerProviders, GateCodeLensProvider } from './providers';
import { CockpitProvider } from './cockpit';
import { registerAi } from './ai';

let statusBar: vscode.StatusBarItem;
let output: vscode.OutputChannel;
let treeProvider: VerdictProvider;
let diagnostics: vscode.DiagnosticCollection;
let cockpit: CockpitProvider;
let codeLens: GateCodeLensProvider;
let ctx: vscode.ExtensionContext;

let results: FolderResult[] = [];
let muted: Set<string> = new Set();
let running = false;
let runTimer: ReturnType<typeof setTimeout> | undefined;
let currentRun: AbortController | undefined;
let devCliPath: string | undefined;

const MUTED_KEY = 'gate.muted';

export function activate(context: vscode.ExtensionContext): void {
  ctx = context;
  output = vscode.window.createOutputChannel('gate');
  muted = new Set(context.workspaceState.get<string[]>(MUTED_KEY, []));

  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBar.command = 'gate.focusCockpit';
  context.subscriptions.push(statusBar, output);
  refreshStatusBar();
  statusBar.show();

  const view: GateView = {
    results: () => results,
    muted: () => muted,
    overall: () => overallStatus(results),
  };

  treeProvider = new VerdictProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('gate.verdict', treeProvider));

  cockpit = new CockpitProvider(view, context.extensionUri);
  context.subscriptions.push(vscode.window.registerWebviewViewProvider(CockpitProvider.viewId, cockpit));

  diagnostics = vscode.languages.createDiagnosticCollection('gate');
  context.subscriptions.push(diagnostics);

  ({ codeLens } = registerProviders(context, view));

  // Running from source (clients/vscode inside the gate repo), the engine lives
  // two levels up. Installed as a .vsix this won't exist, so it's ignored.
  const candidate = path.join(context.extensionPath, '..', '..', 'src', 'cli.js');
  devCliPath = existsSync(candidate) ? candidate : undefined;

  const runner: GateRunner = { run: (req) => runWorkspace(req) };
  registerAi(context, runner, workspaceRoot, configuredPath);

  context.subscriptions.push(
    vscode.commands.registerCommand('gate.check', () => check()),
    vscode.commands.registerCommand('gate.refresh', () => check()),
    vscode.commands.registerCommand('gate.showOutput', () => output.show()),
    vscode.commands.registerCommand('gate.focusCockpit', () => vscode.commands.executeCommand('gate.cockpit.focus')),
    vscode.commands.registerCommand('gate.muteFinding', (key?: string) => muteFinding(key)),
    vscode.commands.registerCommand('gate.clearMutes', () => clearMutes()),
    vscode.commands.registerCommand('gate.installEngine', () => installEngine())
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (vscode.workspace.getConfiguration('gate').get<boolean>('runOnSave', true)) {
        scheduleCheck(debounceMs());
      }
    }),
    vscode.workspace.onDidChangeWorkspaceFolders(() => check())
  );

  check();
}

function debounceMs(): number {
  return Math.max(0, vscode.workspace.getConfiguration('gate').get<number>('debounceMs', 500));
}

function configuredPath(): string | undefined {
  return vscode.workspace.getConfiguration('gate').get<string>('path') || devCliPath;
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

/** Debounced re-check — the last request within the window wins. */
function scheduleCheck(delayMs: number): void {
  if (runTimer) clearTimeout(runTimer);
  runTimer = setTimeout(() => {
    runTimer = undefined;
    void check();
  }, delayMs);
}

/**
 * Run gate across every workspace folder, concurrently. Per-folder failures are
 * captured as a FolderResult.error (not thrown) so one bad folder can't sink the
 * whole run; a cancellation (signal aborted) does propagate so check() can bail.
 */
async function runWorkspace(req: RunRequest): Promise<FolderResult[]> {
  const folders = vscode.workspace.workspaceFolders ?? [];
  const cfg = vscode.workspace.getConfiguration('gate');
  const cp = configuredPath();
  const only = req.only ?? cfg.get<string[]>('only') ?? [];
  const skip = req.skip ?? cfg.get<string[]>('skip') ?? [];
  const strict = req.strict ?? cfg.get<boolean>('strict') ?? false;

  return Promise.all(
    folders.map(async (folder): Promise<FolderResult> => {
      const root = folder.uri.fsPath;
      const name = folder.name || path.basename(root);
      try {
        const verdict = await runGate({ workspaceRoot: root, configuredPath: cp, only, skip, strict, signal: req.signal });
        return { folder: root, name, verdict };
      } catch (err) {
        if (req.signal?.aborted) throw err;
        return { folder: root, name, verdict: null, error: err instanceof Error ? err.message : String(err) };
      }
    })
  );
}

async function check(): Promise<void> {
  if (!vscode.workspace.workspaceFolders?.length) return;

  // Supersede any in-flight run: abort it (kills its child) so a save-storm can't
  // pile up overlapping full-workspace gates racing to write the UI.
  currentRun?.abort();
  const run = new AbortController();
  currentRun = run;

  running = true;
  refreshStatusBar();
  cockpit.setBusy(true);
  try {
    const r = await runWorkspace({ signal: run.signal });
    if (run.signal.aborted) return; // a newer run took over while we awaited
    results = r;
    logResults(r);
  } catch (err) {
    if (run.signal.aborted) return; // cancelled by a newer run — not a failure
    output.appendLine(`[error] ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    // Only the still-current run owns the UI; a superseded run must not clobber
    // the newer run's spinner, verdict, or diagnostics.
    if (currentRun === run) {
      currentRun = undefined;
      running = false;
      refreshStatusBar();
      treeProvider.refresh();
      applyDiagnostics();
      cockpit.setBusy(false);
      codeLens.refresh();
    }
  }
}

function logResults(rs: FolderResult[]): void {
  for (const r of rs) {
    if (r.error) {
      output.appendLine(`[${r.name}] error: ${r.error}`);
      continue;
    }
    const v = r.verdict;
    if (!v) continue;
    output.appendLine(`[${v.generatedAt}] ${r.name}: ${v.verdict.toUpperCase()} (${v.gate.reasons.length} reason(s))`);
  }
}

function applyDiagnostics(): void {
  diagnostics.clear();
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const d of toDiagnosticsMulti(results, muted)) {
    const line = Math.max(0, d.line - 1);
    const range = new vscode.Range(line, 0, line, Number.MAX_SAFE_INTEGER);
    const diag = new vscode.Diagnostic(range, d.message, severityFor(d.severity));
    diag.source = d.source;
    // A clickable rule link in the Problems panel.
    diag.code = { value: d.tool, target: vscode.Uri.parse(toolDocsUrl(d.tool)) };
    const list = byFile.get(d.file) ?? [];
    list.push(diag);
    byFile.set(d.file, list);
  }
  for (const [file, list] of byFile) {
    diagnostics.set(vscode.Uri.file(file), list);
  }
}

async function muteFinding(key?: string): Promise<void> {
  if (!key || muted.has(key)) return;
  muted.add(key);
  await ctx.workspaceState.update(MUTED_KEY, [...muted]);
  refreshAfterMuteChange();
}

async function clearMutes(): Promise<void> {
  if (!muted.size) return;
  muted.clear();
  await ctx.workspaceState.update(MUTED_KEY, []);
  refreshAfterMuteChange();
}

function refreshAfterMuteChange(): void {
  treeProvider.refresh();
  applyDiagnostics();
  cockpit.refresh();
  codeLens.refresh();
}

function installEngine(): void {
  const term = vscode.window.createTerminal('gate');
  term.show();
  term.sendText('npm install -g @nugehs/gate');
}

function severityFor(status: Status): vscode.DiagnosticSeverity {
  switch (status) {
    case 'fail':
    case 'error':
      return vscode.DiagnosticSeverity.Error;
    case 'warn':
    case 'unknown':
      return vscode.DiagnosticSeverity.Warning;
    default:
      return vscode.DiagnosticSeverity.Information;
  }
}

function refreshStatusBar(): void {
  const { text, tooltip } = statusBarTextMulti(results, running);
  statusBar.text = text;
  statusBar.tooltip = tooltip;
}

class VerdictProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private roots: TreeNode[] = toTreeMulti([]);

  refresh(): void {
    this.roots = toTreeMulti(results);
    this._onDidChange.fire();
  }

  getChildren(node?: TreeNode): TreeNode[] {
    return node ? node.children ?? [] : this.roots;
  }

  getTreeItem(node: TreeNode): vscode.TreeItem {
    const expandable = (node.children?.length ?? 0) > 0;
    const item = new vscode.TreeItem(
      node.label,
      expandable ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.None
    );
    item.description = node.description;
    item.tooltip = node.tooltip;
    if (node.status) item.iconPath = iconFor(node.status);
    if (node.file) {
      const args: unknown[] = [vscode.Uri.file(node.file)];
      if (typeof node.line === 'number') {
        const l = Math.max(0, node.line - 1);
        args.push({ selection: new vscode.Range(l, 0, l, 0) });
      }
      item.command = { command: 'vscode.open', title: 'Open', arguments: args };
    }
    return item;
  }
}

function iconFor(status: Status): vscode.ThemeIcon {
  switch (status) {
    case 'pass':
      return new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
    case 'warn':
    case 'unknown':
      return new vscode.ThemeIcon('warning', new vscode.ThemeColor('charts.yellow'));
    case 'fail':
    case 'error':
      return new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
    case 'skipped':
      return new vscode.ThemeIcon('circle-slash');
    default:
      return new vscode.ThemeIcon('circle-outline');
  }
}

export function deactivate(): void {
  if (runTimer) clearTimeout(runTimer);
  currentRun?.abort();
}
