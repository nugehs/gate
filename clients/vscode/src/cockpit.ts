// Tier 3 — the verdict "cockpit": a webview view in gate's own Activity Bar
// container. It renders the same unified verdict the CLI prints, but as an
// interactive board — click a finding to jump to it, mute it, or re-check.
//
// It reads the latest run through GateView and never runs the engine directly;
// every action posts a message that the extension turns into a command.

import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { overallStatus, findingKey, type GateView, type FolderResult, type DomainResult, type Finding } from './gate';

type Msg =
  | { type: 'check' }
  | { type: 'install' }
  | { type: 'clearMutes' }
  | { type: 'mute'; key: string }
  | { type: 'open'; file: string; line?: number };

export class CockpitProvider implements vscode.WebviewViewProvider {
  static readonly viewId = 'gate.cockpit';
  private webviewView?: vscode.WebviewView;
  private busy = false;

  constructor(private readonly view: GateView, private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.webviewView = webviewView;
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.onDidReceiveMessage((m: Msg) => this.onMessage(m));
    this.render();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.render();
  }

  refresh(): void {
    this.render();
  }

  private onMessage(m: Msg): void {
    switch (m?.type) {
      case 'check':
        vscode.commands.executeCommand('gate.check');
        break;
      case 'install':
        vscode.commands.executeCommand('gate.installEngine');
        break;
      case 'clearMutes':
        vscode.commands.executeCommand('gate.clearMutes');
        break;
      case 'mute':
        if (m.key) vscode.commands.executeCommand('gate.muteFinding', m.key);
        break;
      case 'open':
        if (typeof m.file === 'string') {
          const l = typeof m.line === 'number' ? Math.max(0, m.line - 1) : 0;
          vscode.commands.executeCommand('vscode.open', vscode.Uri.file(m.file), {
            selection: new vscode.Range(l, 0, l, 0),
          });
        }
        break;
    }
  }

  private render(): void {
    if (!this.webviewView) return;
    const w = this.webviewView.webview;
    w.html = renderHtml(w, this.view, this.busy);
  }
}

// ---- HTML rendering (pure-ish string building) ----

const STATUS_CLASS: Record<string, string> = {
  pass: 'ok',
  warn: 'warn',
  unknown: 'warn',
  fail: 'bad',
  error: 'bad',
  skipped: 'mute',
};

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function resolveAbs(file: string, root: string): string {
  return path.isAbsolute(file) ? file : path.join(root, file);
}

function nonceStr(): string {
  return randomBytes(16).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 24);
}

function findingRow(d: DomainResult, f: Finding, root: string, muted: ReadonlySet<string>): string {
  const title = String(f.title ?? f.id ?? 'finding');
  const hasLoc = typeof f.file === 'string' && f.file;
  const abs = hasLoc ? resolveAbs(String(f.file), root) : '';
  const line = typeof f.line === 'number' && f.line > 0 ? f.line : 1;
  const key = hasLoc ? findingKey(d.tool, abs, line, title) : '';
  if (key && muted.has(key)) return '';

  const loc = hasLoc ? `${path.basename(abs)}:${line}` : '';
  const sev = f.severity ? `<span class="sev">${esc(f.severity)}</span>` : '';
  const openAttr = hasLoc ? ` data-open="${esc(abs)}" data-line="${line}"` : '';
  const muteBtn = key ? `<button class="mute" data-mute="${esc(key)}" title="Mute this finding">mute</button>` : '';
  return `<li class="finding"${openAttr}>
    <span class="ftitle">${esc(title)}</span>${sev}
    ${loc ? `<span class="loc">${esc(loc)}</span>` : ''}
    ${muteBtn}
  </li>`;
}

function domainCard(d: DomainResult, root: string, muted: ReadonlySet<string>): string {
  const cls = STATUS_CLASS[d.status] ?? 'mute';
  const rows = (d.findings ?? []).map((f) => findingRow(d, f, root, muted)).join('');
  return `<div class="card ${cls}">
    <div class="card-head">
      <span class="dot"></span>
      <span class="label">${esc(d.label)}</span>
      <span class="status">${esc(d.status)}</span>
    </div>
    <div class="summary">${esc(d.summary)}</div>
    ${rows ? `<ul class="findings">${rows}</ul>` : ''}
  </div>`;
}

function folderBlock(r: FolderResult, showName: boolean, muted: ReadonlySet<string>): string {
  if (r.error) {
    return `<div class="folder">
      ${showName ? `<h3>${esc(r.name)}</h3>` : ''}
      <div class="card bad"><div class="card-head"><span class="dot"></span><span class="label">could not run</span></div>
      <div class="summary">${esc(r.error)}</div></div>
    </div>`;
  }
  const v = r.verdict;
  if (!v) return '';
  const reasons = v.gate?.reasons ?? [];
  const cards = v.domains.map((d) => domainCard(d, v.repo.root, muted)).join('');
  const reasonList = reasons.length
    ? `<div class="reasons"><div class="reasons-h">Blocking reasons</div><ul>${reasons.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`
    : '';
  return `<div class="folder">
    ${showName ? `<h3>${esc(r.name)} — <span class="v-${v.verdict}">${esc(v.verdict.toUpperCase())}</span></h3>` : ''}
    ${cards}
    ${reasonList}
  </div>`;
}

function renderHtml(webview: vscode.Webview, view: GateView, busy: boolean): string {
  const results = view.results();
  const muted = view.muted();
  const overall = overallStatus(results);
  const nonce = nonceStr();
  const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';`;

  const engineMissing = results.length > 0 && results.every((r) => r.error && /could not run gate|enoent|not found/i.test(r.error));

  let body: string;
  if (busy) {
    body = `<div class="empty">Running gate…</div>`;
  } else if (results.length === 0) {
    body = `<div class="empty">No workspace folder open.</div>`;
  } else if (engineMissing) {
    body = `<div class="empty">
      <p>The <code>gate</code> engine isn't installed.</p>
      <button id="install" class="primary">Install @nugehs/gate</button>
      <p class="hint">Or set <code>gate.path</code> in settings.</p>
    </div>`;
  } else {
    const showNames = results.length > 1;
    body = results.map((r) => folderBlock(r, showNames, muted)).join('');
  }

  const overallLabel = overall === 'none' ? '—' : overall.toUpperCase();
  const mutedCount = muted.size;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style nonce="${nonce}">
  :root { color-scheme: light dark; }
  body { font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); color: var(--vscode-foreground); padding: 0 4px 12px; }
  .bar { display: flex; align-items: center; gap: 8px; position: sticky; top: 0; background: var(--vscode-sideBar-background); padding: 8px 2px; border-bottom: 1px solid var(--vscode-panel-border); z-index: 1; }
  .badge { font-weight: 700; padding: 2px 8px; border-radius: 4px; letter-spacing: .04em; }
  .badge.ok { background: var(--vscode-testing-iconPassed, #2ea043); color: #fff; }
  .badge.warn { background: var(--vscode-charts-yellow, #d7a000); color: #000; }
  .badge.bad { background: var(--vscode-charts-red, #e5534b); color: #fff; }
  .badge.none { background: var(--vscode-descriptionForeground); color: var(--vscode-editor-background); }
  .grow { flex: 1; }
  button { font: inherit; color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: none; padding: 3px 10px; border-radius: 3px; cursor: pointer; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:hover { background: var(--vscode-button-hoverBackground); }
  h3 { margin: 12px 2px 6px; font-size: 1em; }
  .card { border: 1px solid var(--vscode-panel-border); border-left-width: 3px; border-radius: 4px; padding: 7px 9px; margin: 7px 0; background: var(--vscode-editorWidget-background); }
  .card.ok { border-left-color: var(--vscode-testing-iconPassed, #2ea043); }
  .card.warn { border-left-color: var(--vscode-charts-yellow, #d7a000); }
  .card.bad { border-left-color: var(--vscode-charts-red, #e5534b); }
  .card.mute { border-left-color: var(--vscode-descriptionForeground); opacity: .75; }
  .card-head { display: flex; align-items: center; gap: 7px; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }
  .ok .dot { color: var(--vscode-testing-iconPassed, #2ea043); }
  .warn .dot { color: var(--vscode-charts-yellow, #d7a000); }
  .bad .dot { color: var(--vscode-charts-red, #e5534b); }
  .mute .dot { color: var(--vscode-descriptionForeground); }
  .label { font-weight: 600; flex: 1; }
  .status { text-transform: uppercase; font-size: .82em; color: var(--vscode-descriptionForeground); }
  .summary { color: var(--vscode-descriptionForeground); margin: 3px 0 0 15px; font-size: .92em; }
  ul.findings { list-style: none; margin: 6px 0 0; padding: 0 0 0 15px; }
  li.finding { display: flex; align-items: center; gap: 6px; padding: 2px 0; cursor: pointer; }
  li.finding:hover { color: var(--vscode-textLink-activeForeground); }
  .ftitle { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .sev { font-size: .75em; padding: 0 4px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .loc { font-size: .8em; color: var(--vscode-descriptionForeground); margin-left: auto; }
  .mute { font-size: .75em; padding: 0 6px; background: transparent; color: var(--vscode-descriptionForeground); border: 1px solid var(--vscode-panel-border); }
  .reasons { margin: 8px 0 0; padding: 7px 9px; border-radius: 4px; background: var(--vscode-inputValidation-errorBackground, rgba(229,83,75,.1)); }
  .reasons-h { font-weight: 600; margin-bottom: 3px; }
  .reasons ul { margin: 0; padding-left: 16px; }
  .empty { text-align: center; color: var(--vscode-descriptionForeground); padding: 24px 8px; }
  .empty .primary { margin: 8px 0; }
  .hint { font-size: .85em; }
  .v-pass { color: var(--vscode-testing-iconPassed, #2ea043); }
  .v-warn { color: var(--vscode-charts-yellow, #d7a000); }
  .v-fail { color: var(--vscode-charts-red, #e5534b); }
  code { background: var(--vscode-textCodeBlock-background); padding: 0 3px; border-radius: 3px; }
</style>
</head>
<body>
  <div class="bar">
    <span class="badge ${STATUS_CLASS[overall] ?? 'none'}">${esc(overallLabel)}</span>
    <span class="grow"></span>
    ${mutedCount ? `<button class="secondary" id="clear" title="Clear ${mutedCount} muted finding(s)">muted: ${mutedCount}</button>` : ''}
    <button id="recheck">Re-check</button>
  </div>
  ${body}
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('recheck')?.addEventListener('click', () => vscode.postMessage({ type: 'check' }));
    document.getElementById('install')?.addEventListener('click', () => vscode.postMessage({ type: 'install' }));
    document.getElementById('clear')?.addEventListener('click', () => vscode.postMessage({ type: 'clearMutes' }));
    document.body.addEventListener('click', (e) => {
      const mute = e.target.closest('[data-mute]');
      if (mute) { e.stopPropagation(); vscode.postMessage({ type: 'mute', key: mute.getAttribute('data-mute') }); return; }
      const row = e.target.closest('[data-open]');
      if (row) { vscode.postMessage({ type: 'open', file: row.getAttribute('data-open'), line: Number(row.getAttribute('data-line')) }); }
    });
  </script>
</body>
</html>`;
}
