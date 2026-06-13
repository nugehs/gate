# Changelog

All notable changes to `@nugehs/gate` are documented here.

## [Unreleased]

- Findings now carry `file` and `line` where the underlying tool provides a
  location (aiglare surfaces, tieline drift), so editor clients can place
  diagnostics on the exact line. bouncer (missing-control absences) and repoctx
  (repo-level checks) remain location-free by nature.

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
