# gate — VS Code & Cursor extension

One ship/no-ship verdict in your editor. The extension runs
[`@nugehs/gate`](https://github.com/nugehs/gate) against your workspace and shows
the unified verdict from **aiglare**, **bouncer**, **tieline** and **repoctx**.

> Cursor, VSCodium and Windsurf are VS Code forks — this is the same extension
> for all of them. Install it from [Open VSX](https://open-vsx.org) or from a
> packaged `.vsix`.

## What you get (v1)

- **Status bar** — `✓ / ⚠ / ✗ gate: VERDICT`. Click to re-check.
- **`gate` panel** (Explorer) — the four checks with their status and summary,
  expandable to findings.
- **Command** — `gate: Check Workspace`.
- **Run on save** — re-checks when you save (toggle with `gate.runOnSave`).

Inline diagnostics (squiggles on the exact lines) are the next milestone — they
need each tool's findings to carry `file:line`.

## Requirements

The `gate` engine must be resolvable. The extension looks, in order, for:

1. `gate.path` setting (explicit path to the bin or `src/cli.js`)
2. `node_modules/.bin/gate` in the workspace
3. `gate` on `PATH`
4. `npx @nugehs/gate`

## Settings

| Setting | Default | Meaning |
| --- | --- | --- |
| `gate.path` | `""` | Explicit path to gate (bin or `src/cli.js`). |
| `gate.runOnSave` | `true` | Re-run gate on file save. |
| `gate.only` | `[]` | Run only these checks. |
| `gate.skip` | `[]` | Skip these checks. |

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
