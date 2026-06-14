## Install the engine

The extension is a thin client over the **`@nugehs/gate`** CLI. Install it once:

```
npm i -g @nugehs/gate      # global
# or, per project:
npm i -D @nugehs/gate
```

The extension resolves the engine in this order:

1. the `gate.path` setting
2. `node_modules/.bin/gate` in your workspace
3. `gate` on your `PATH`
4. `npx @nugehs/gate` (no install needed, just slower on first run)

You don't need all four underlying tools (aiglare, bouncer, tieline, repoctx) —
any that aren't configured are reported as **skipped**, never a failure.
