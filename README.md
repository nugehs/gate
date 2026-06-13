# gate

**One ship/no-ship verdict from your whole nugehs toolchain.**

[![npm](https://img.shields.io/npm/v/@nugehs/gate?style=flat-square)](https://www.npmjs.com/package/@nugehs/gate) [![license: MIT](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE) [![node](https://img.shields.io/node/v/@nugehs/gate?style=flat-square)](https://www.npmjs.com/package/@nugehs/gate)

`gate` runs [aiglare](https://www.npmjs.com/package/@nugehs/aiglare),
[bouncer](https://www.npmjs.com/package/@nugehs/bouncer),
[tieline](https://www.npmjs.com/package/@nugehs/tieline) and
[repoctx](https://www.npmjs.com/package/@nugehs/repoctx) against a repo and
merges their four dialects into **one normalized verdict**. Each tool already
answers a different "can this ship?" question — gate is the place they finally
agree on the answer.

```
npx @nugehs/gate                      # audit the current repo
npx @nugehs/gate ./service --ci       # fail the build on a blocking verdict
npx @nugehs/gate --json               # the unified verdict, machine-readable
```

```
        ┌──────────────────────────────────────────────┐
        │                   gate                         │
        │   one config · one verdict · one report        │
        └──────────────────────────────────────────────┘
            │            │            │            │
        aiglare       bouncer      tieline      repoctx
       red/amber/    pass/fail/   matched/     PASS/WARN/
         green        unknown      drift         FAIL
            │            │            │            │
            └──── normalize to pass · warn · fail ─────┘
                          │
                  ✗ FAIL   ⚠ WARN   ✓ PASS
```

## What it reports

```
  gate · /path/to/repo

  ✗  AI governance    fail      2 red · 1 amber · 13 green · 1 blocking side-effect
  ·  Compliance       skipped   not configured (run `bouncer init`)
  ·  Contract drift   skipped   not configured (run `tieline init`)
  ⚠  Merge readiness  warn      1 of 8 checks need attention

  verdict: FAIL — 1 blocking · 1 warn · 2 skipped
```

Each tool's native result is normalized onto one status vocabulary:

| Status | Meaning |
| --- | --- |
| `pass`    | the check ran and is clean |
| `warn`    | ran, found something worth a look — not blocking |
| `fail`    | ran, found a blocking problem |
| `unknown` | ran, but couldn't determine — explicitly **not** a pass |
| `skipped` | not applicable / not configured for this repo |
| `error`   | the tool couldn't be run, or returned garbage |

The top-level verdict is the worst across the domains that actually ran
(`skipped` never counts). `unknown` and `error` roll up to `warn` so nothing
slips through as a silent pass.

## How each dialect maps

| Tool | Native signal | → gate |
| --- | --- | --- |
| **aiglare** | a red surface on a side-effectful sink | `fail`; any red/amber → `warn` |
| **bouncer** | a `fail` finding (missing required control) | `fail`; any `unknown` control → `unknown` |
| **tieline** | `drift` > 0 (FE call with no BE route) | `fail`; `unverifiable` > 0 → `warn` |
| **repoctx** | `FAIL`/`BLOCK` merge verdict | `fail`; `WARN` → `warn` |

> gate runs aiglare **without** `--ci` and derives the blocking verdict itself,
> so a tool that `process.exit()`s before flushing its pipe can't truncate the
> report it feeds us.

## CLI

```
gate [path] [options]

  --json            Emit the unified verdict as JSON
  --ci              Exit non-zero when the gate fails (blocking by default)
  --strict          Treat WARN/UNKNOWN as blocking too
  --only <list>     Run only these tools (aiglare,bouncer,tieline,repoctx)
  --skip <list>     Skip these tools
  -h, --help        Show this help
```

By default only a `fail` verdict blocks under `--ci` — safe to adopt without
drowning a team in warnings. Add `--strict` when you want warnings to gate too.

## Tool resolution

gate doesn't bundle the four tools; it finds each one at runtime. Per tool, first hit wins:

1. `GATE_<TOOL>_BIN` environment variable (explicit override)
2. the installed `@nugehs/<tool>` package (from `node_modules`)
3. a sibling checkout at `../<tool>` (local development)

A tool that can't be resolved is reported as `skipped`, never a hard failure —
so `gate` is safe to run in a repo that only uses some of the toolchain.

## In CI

```yaml
- run: npx @nugehs/gate . --ci
```

For a machine-readable record, `--json` emits the full verdict (schema version,
per-domain results, counts, and the blocking reasons) for dashboards or audit
evidence.

## Roadmap

gate is the shared spine. The same normalized verdict is meant to drive more
than the CLI:

- **MCP server** — expose the unified verdict as one tool for agents (each of the four is already an MCP server).
- **Web cockpit** — a repo/PR verdict board over the JSON, unifying the four `*-web` sites.
- **Editor extension** — shift the gates left from CI into the editor as inline findings.

## License

MIT © Oluwasegun Olumbe
