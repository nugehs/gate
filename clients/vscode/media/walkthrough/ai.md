## Ask the AI

gate is wired into the editor's AI surfaces, so the assistant writing your code is
checked by the same gate your CI uses.

- **`@gate` chat participant** — in Copilot Chat, type `@gate can this ship?` or
  `@gate /why` to get the verdict and the blocking reasons in plain language.
- **Agent tool** — in agent mode, the model can call the **`#gate`** tool itself
  before it claims a change is ready. A `fail` verdict tells it not to ship.
- **MCP server** — gate registers its MCP server with the editor, so any
  MCP-aware agent gets the unified `gate_check` tool automatically.

This is the whole point of the nugehs toolchain: governance that travels with the
code, from the editor to CI.
