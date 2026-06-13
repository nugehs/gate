import * as vscode from 'vscode';
import * as path from 'node:path';
import { existsSync } from 'node:fs';
import { runGate, statusBarText, toTree, type TreeNode, type Verdict, type Status } from './gate';

let statusBar: vscode.StatusBarItem;
let output: vscode.OutputChannel;
let provider: VerdictProvider;
let lastVerdict: Verdict | null = null;
let running = false;
let devCliPath: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel('gate');
  statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
  statusBar.command = 'gate.check';
  context.subscriptions.push(statusBar, output);
  refreshStatusBar();
  statusBar.show();

  provider = new VerdictProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider('gate.verdict', provider));

  // When running from source (clients/vscode inside the gate repo), the engine
  // lives two levels up. Installed as a .vsix this won't exist, so it's ignored.
  const candidate = path.join(context.extensionPath, '..', '..', 'src', 'cli.js');
  devCliPath = existsSync(candidate) ? candidate : undefined;

  context.subscriptions.push(
    vscode.commands.registerCommand('gate.check', () => check()),
    vscode.commands.registerCommand('gate.refresh', () => check())
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (vscode.workspace.getConfiguration('gate').get<boolean>('runOnSave', true)) {
        check();
      }
    })
  );

  check();
}

function workspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

async function check(): Promise<void> {
  const root = workspaceRoot();
  if (!root) return;

  const cfg = vscode.workspace.getConfiguration('gate');
  running = true;
  refreshStatusBar();
  try {
    lastVerdict = await runGate({
      workspaceRoot: root,
      configuredPath: cfg.get<string>('path') || devCliPath,
      only: cfg.get<string[]>('only') ?? [],
      skip: cfg.get<string[]>('skip') ?? [],
    });
    const v = lastVerdict;
    output.appendLine(`[${v.generatedAt}] ${v.repo.name}: ${v.verdict.toUpperCase()} (${v.gate.reasons.length} reason(s))`);
  } catch (err) {
    lastVerdict = null;
    const message = err instanceof Error ? err.message : String(err);
    output.appendLine(`[error] ${message}`);
    vscode.window.showWarningMessage(`gate: ${message}`);
  } finally {
    running = false;
    refreshStatusBar();
    provider.refresh(lastVerdict);
  }
}

function refreshStatusBar(): void {
  const { text, tooltip } = statusBarText(lastVerdict, running);
  statusBar.text = text;
  statusBar.tooltip = tooltip;
}

class VerdictProvider implements vscode.TreeDataProvider<TreeNode> {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this._onDidChange.event;
  private roots: TreeNode[] = toTree(null);

  refresh(v: Verdict | null): void {
    this.roots = toTree(v);
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
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [vscode.Uri.file(node.file)],
      };
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
  /* nothing to clean up beyond context.subscriptions */
}
