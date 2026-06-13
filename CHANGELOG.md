# Changelog

All notable changes to `@nugehs/gate` are documented here.

## 0.1.0

Initial release.

- Runs aiglare, bouncer, tieline & repoctx against a repo and merges their four
  dialects (red/amber/green, pass/fail/unknown, matched/drift, PASS/WARN/FAIL)
  into one normalized verdict (`pass | warn | fail | unknown | skipped | error`).
- `--ci` gate blocks on a `fail` verdict by default; `--strict` also blocks on warnings.
- A run where no domain executes (everything skipped or deselected) is **not** a
  pass — under `--ci` it fails, so a typo can't silently turn the gate into a no-op.
- Per-tool resolution: `GATE_<TOOL>_BIN` env → installed `@nugehs/<tool>` → `../<tool>` sibling checkout.
- Terminal and JSON reporters; `--only` / `--skip` tool selection.
