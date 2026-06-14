# gate — VS Code & Cursor extension

**One ship/no-ship verdict in your editor — and in your AI assistant.**

The extension runs [`@nugehs/gate`](https://github.com/nugehs/gate) against your
workspace and turns the unified verdict from **aiglare** (AI governance),
**bouncer** (compliance), **tieline** (contract drift) and **repoctx** (merge
readiness) into a live editor surface.

> Cursor, VSCodium and Windsurf are VS Code forks — this is the same extension
> for all of them. Install it from [Open VSX](https://open-vsx.org) or a packaged
> `.vsix`.

## What you get

### The verdict, everywhere

- **Status bar** — `✓ / ⚠ / ✗ gate: VERDICT`. Click to open the cockpit.
- **Verdict cockpit** — a board in gate's own Activity Bar container: the overall
  verdict, a card per domain, the blocking reasons, and every located finding.
  Click a finding to jump to it, mute it, or re-check — all without leaving it.
- **Checks tree** — the four domains, expandable to findings (multi-root
  workspaces get a folder layer on top).
- **Inline diagnostics** — squiggles on the exact line for findings that carry a
  location (aiglare red surfaces, tieline drift), with a clickable rule link.

### Interactive findings

- **Quick Fixes** on any finding — **Mute** it (per-workspace, reversible) or
  **open the tool's docs**.
- **Hovers** with the full finding detail and a one-click mute.
- **CodeLens** above any line that carries a finding (toggle with `gate.codeLens`).

### AI-native gating

The assistant writing your code is checked by the same gate your CI uses:

- **`@gate` chat participant** — ask `@gate can this ship?`, or `@gate /why` for
  the blocking reasons in plain language.
- **Agent tool** — in agent mode the model can call the **`gate_check`** tool
  itself before it claims a change is ready; a `fail` verdict tells it not to ship.
- **MCP server** — gate registers its own MCP server with the editor, so any
  MCP-aware agent gets the unified `gate_check` tool automatically.

### A feedback loop that keeps up

- **Run on save**, debounced — a save-storm collapses into one run.
- **In-flight runs are superseded** (the child process is killed) instead of
  piling up overlapping full-repo gates.
- **Multi-root** — every workspace folder is checked; the status bar reports the
  worst verdict across them.

> Squiggles, hovers and CodeLens need the engine to emit `file:line` and the full
> finding set (gate ≥ 0.3.0). Against an older engine the verdict still works; the
> located surfaces simply thin out. bouncer (a missing control is an *absence*,
> no line) and repoctx (repo-level) stay in the cockpit and tree by nature.

## Requirements

The `gate` engine must be resolvable. The extension looks, in order, for:

1. `gate.path` setting (explicit path to the bin or `src/cli.js`)
2. `node_modules/.bin/gate` in the workspace
3. `gate` on `PATH`
4. `npx @nugehs/gate`

No engine installed? Run **gate: Install the gate engine** (or the button in the
cockpit / walkthrough).

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `gate.path` | `""` | Explicit path to gate (bin or `src/cli.js`). |
| `gate.runOnSave` | `true` | Re-run gate on file save (debounced). |
| `gate.strict` | `false` | Treat WARN/UNKNOWN as blocking too (`--strict`). |
| `gate.codeLens` | `true` | Show a CodeLens above lines with a finding. |
| `gate.debounceMs` | `500` | Delay after the last save before re-running. |
| `gate.only` | `[]` | Run only these checks. |
| `gate.skip` | `[]` | Skip these checks. |

## Commands

`gate: Check Workspace`, `gate: Refresh`, `gate: Open Verdict Cockpit`,
`gate: Show Output Log`, `gate: Clear Muted Findings`,
`gate: Install the gate engine`.

## Develop

```
npm install
npm run compile     # tsc → out/
npm test            # compile + node:test on the pure logic
# Press F5 in VS Code/Cursor to launch the Extension Development Host.
```

Run from source inside the gate repo, the extension auto-resolves the engine at
`../../src/cli.js` — no global install needed.

## Publish

```
npm run package        # build the .vsix
npm run publish:vsce   # VS Code Marketplace
npm run publish:ovsx   # Open VSX (Cursor / VSCodium / Windsurf)
```

MIT © Oluwasegun Olumbe
