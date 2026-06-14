// Tier 2 — turn read-only squiggles into interactive findings:
//   • Quick Fixes  (mute a finding, open the tool's docs)
//   • Hovers       (full finding detail on the exact line)
//   • CodeLens     (an inline marker above any line that carries a finding)
//
// All three read the latest run through the shared GateView and locate findings
// per file with findingsForFile() — they never re-run the engine themselves.

import * as vscode from 'vscode';
import { findingsForFile, toolDocsUrl, type GateView } from './gate';

const SELECTOR: vscode.DocumentSelector = { scheme: 'file' };

export class GateCodeActionProvider implements vscode.CodeActionProvider {
  constructor(private readonly view: GateView) {}

  provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range
  ): vscode.CodeAction[] {
    const hits = findingsForFile(this.view.results(), document.uri.fsPath, this.view.muted()).filter(
      (f) => f.line - 1 >= range.start.line && f.line - 1 <= range.end.line
    );

    const actions: vscode.CodeAction[] = [];
    for (const f of hits) {
      const mute = new vscode.CodeAction(`gate: Mute “${f.title}” (${f.tool})`, vscode.CodeActionKind.QuickFix);
      mute.command = { command: 'gate.muteFinding', title: 'Mute finding', arguments: [f.key] };
      actions.push(mute);

      const docs = new vscode.CodeAction(`gate: Open ${f.tool} docs`, vscode.CodeActionKind.QuickFix);
      docs.command = { command: 'vscode.open', title: 'Open docs', arguments: [vscode.Uri.parse(toolDocsUrl(f.tool))] };
      actions.push(docs);
    }
    return actions;
  }
}

export class GateHoverProvider implements vscode.HoverProvider {
  constructor(private readonly view: GateView) {}

  provideHover(document: vscode.TextDocument, position: vscode.Position): vscode.Hover | undefined {
    const hits = findingsForFile(this.view.results(), document.uri.fsPath, this.view.muted()).filter(
      (f) => f.line - 1 === position.line
    );
    if (!hits.length) return undefined;

    const md = new vscode.MarkdownString(undefined, true);
    md.isTrusted = { enabledCommands: ['gate.muteFinding'] };
    for (const f of hits) {
      const muteArg = encodeURIComponent(JSON.stringify([f.key]));
      md.appendMarkdown(`$(shield) **gate · ${f.tool}** — \`${f.severity}\`\n\n`);
      md.appendMarkdown(`${f.message}\n\n`);
      md.appendMarkdown(`[Mute](command:gate.muteFinding?${muteArg}) · [${f.tool} docs](${toolDocsUrl(f.tool)})\n\n`);
    }
    return new vscode.Hover(md);
  }
}

export class GateCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;

  constructor(private readonly view: GateView) {}

  /** Re-emit lenses after a new run or a mute toggle. */
  refresh(): void {
    this._onDidChange.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!vscode.workspace.getConfiguration('gate').get<boolean>('codeLens', true)) return [];
    return findingsForFile(this.view.results(), document.uri.fsPath, this.view.muted()).map((f) => {
      const line = Math.max(0, f.line - 1);
      const lens = new vscode.CodeLens(new vscode.Range(line, 0, line, 0));
      lens.command = { command: 'gate.focusCockpit', title: `$(shield) gate · ${f.tool}: ${f.title}` };
      return lens;
    });
  }
}

/** Register all three providers for on-disk files. */
export function registerProviders(
  context: vscode.ExtensionContext,
  view: GateView
): { codeLens: GateCodeLensProvider } {
  const codeLens = new GateCodeLensProvider(view);
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(SELECTOR, new GateCodeActionProvider(view), {
      providedCodeActionKinds: [vscode.CodeActionKind.QuickFix],
    }),
    vscode.languages.registerHoverProvider(SELECTOR, new GateHoverProvider(view)),
    vscode.languages.registerCodeLensProvider(SELECTOR, codeLens)
  );
  return { codeLens };
}
