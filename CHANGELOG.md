# Changelog

All notable changes to `@nugehs/gate` are documented here.

## [extension 0.3.1] - 2026-06-14

Extension-only release; the engine stays at 0.3.0. No functional changes to the
extension itself — it is re-cut to validate (and record a clean run of) the now
fully-automated dual-store pipeline: a single `ext-v*` tag publishes to both the
VS Code Marketplace and Open VSX, using the hardened workflow from 0.3.0
(Node 24-ready actions, idempotent release attach).

## [0.3.0] - 2026-06-14

### Engine

- Findings are no longer capped at 5 per domain in the JSON. That cap was a
  terminal-display nicety that leaked into the data model and starved editor
  clients of squiggles on any repo with more than a handful of findings. The
  `findings` array is now bounded only by a high runaway guard (`MAX_FINDINGS`),
  and the summary counts already carry the true totals.
- Editor clients can pass `--strict` per run (e.g. from a `gate.strict` setting).

### VS Code / Cursor extension (`clients/vscode` 0.3.0)

The extension grows from a read-only verdict mirror into a full editor surface:

- **AI-native gating** — an `@gate` chat participant (`@gate can this ship?`,
  `@gate /why`), a `gate_check` Language Model tool agent mode can call before it
  declares a change done, and an MCP server provider that registers gate's own
  MCP server with the editor. The assistant writing the code is checked by the
  same gate CI uses.
- **Verdict cockpit** — a webview in gate's own Activity Bar container: the
  unified verdict as an interactive board (jump to a finding, mute it, re-check).
- **Interactive findings** — Quick Fixes (mute a finding, open the tool's docs),
  hovers with full detail, and a CodeLens above any line that carries a finding.
- **Faster, safer feedback loop** — saves are debounced and an in-flight run is
  superseded (its child killed) instead of piling up overlapping full-repo gates.
- **Multi-root workspaces** — every folder is checked; the status bar shows the
  worst verdict, the tree gains a per-folder layer.
- **More settings** — `gate.strict`, `gate.codeLens`, `gate.debounceMs`; a
  getting-started walkthrough; and an "install the engine" flow.

## [0.2.0] - 2026-06-14

- Findings now carry `file` and `line` where the underlying tool provides a
  location (aiglare surfaces, tieline drift), so editor clients can place
  diagnostics on the exact line. bouncer (missing-control absences) and repoctx
  (repo-level checks) remain location-free by nature.
- Ships the VS Code / Cursor extension (`clients/vscode`) — unified verdict in
  the status bar, an Explorer panel, and inline squiggles from the above.

## [0.1.1] - 2026-06-13

Release-automation validation; no changes to the published CLI/library.

- Repo: add the VS Code / Cursor extension (`clients/vscode`) and the
  tag-triggered release workflow (`release.yml`: npm OIDC publish + GitHub
  Release + MCP Registry).

## [0.1.0] - 2026-06-13

Initial release.

- Runs aiglare, bouncer, tieline & repoctx against a repo and merges their four
  dialects (red/amber/green, pass/fail/unknown, matched/drift, PASS/WARN/FAIL)
  into one normalized verdict (`pass | warn | fail | unknown | skipped | error`).
- `--ci` gate blocks on a `fail` verdict by default; `--strict` also blocks on warnings.
- A run where no domain executes (everything skipped or deselected) is **not** a
  pass — under `--ci` it fails, so a typo can't silently turn the gate into a no-op.
- Per-tool resolution: `GATE_<TOOL>_BIN` env → installed `@nugehs/<tool>` → `../<tool>` sibling checkout.
- Terminal and JSON reporters; `--only` / `--skip` tool selection.
