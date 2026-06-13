#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import { runGate } from './orchestrator.js';
import { renderTerminal } from './report/terminal.js';
import { startMcpServer } from './mcp.js';
import { ADAPTERS } from './adapters/index.js';

const TOOLS = ADAPTERS.map((a) => a.tool);
const KNOWN = new Set(TOOLS);

const HELP = `gate — one verdict from aiglare, bouncer, tieline & repoctx

Usage:  gate [path] [options]

Runs the four nugehs checks against a repo and merges their results into a
single ship/no-ship verdict.

Options:
  --json            Emit the unified verdict as JSON
  --ci              Exit non-zero when the gate fails (blocking by default)
  --strict          Treat WARN/UNKNOWN as blocking too
  --only <list>     Run only these tools (comma-separated: ${TOOLS.join(',')})
  --skip <list>     Skip these tools
  -h, --help        Show this help

Subcommand:
  gate mcp          Start the MCP server (stdio) — exposes gate_check + list_checks

A run where no domain actually executes (everything skipped or deselected) is
NOT a pass — under --ci it fails, so a typo can't silently defeat the gate.

Tool resolution (per tool, first hit wins):
  1. GATE_<TOOL>_BIN env var   2. installed @nugehs/<tool>   3. ../<tool> sibling checkout

Examples:
  gate                                  # audit the current repo
  gate ./service --ci                   # fail the build on a blocking verdict
  gate --only aiglare,repoctx --json    # just those two, machine-readable
  gate --skip tieline --strict          # everything but tieline, warnings block
`;

function parseList(v) {
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Pure arg parser — returns `{ help }`, `{ error: {code, message} }`, or `{ args }`.
 * Kept side-effect-free (no process.exit, no process.cwd) so it is unit-testable.
 */
export function parseArgs(argv) {
  const args = { path: null, json: false, ci: false, strict: false, only: null, skip: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      return { help: true };
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--ci') {
      args.ci = true;
    } else if (a === '--strict') {
      args.strict = true;
    } else if (a === '--only' || a === '--skip') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('-')) {
        return { error: { code: 2, message: `${a} requires a comma-separated tool list (${TOOLS.join(',')})` } };
      }
      i++;
      const list = parseList(v);
      if (list.length === 0) {
        return { error: { code: 2, message: `${a} requires at least one tool` } };
      }
      const unknown = list.filter((t) => !KNOWN.has(t));
      if (unknown.length) {
        return { error: { code: 2, message: `Unknown tool: ${unknown.join(', ')} (expected one of ${TOOLS.join(', ')})` } };
      }
      if (a === '--only') args.only = list;
      else args.skip = list;
    } else if (a.startsWith('-')) {
      return { error: { code: 2, message: `Unknown option: ${a}` } };
    } else {
      args.path = a;
    }
  }
  return { args };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv[0] === 'mcp') {
    await startMcpServer();
    return;
  }

  const parsed = parseArgs(argv);
  if (parsed.help) {
    process.stdout.write(HELP);
    process.exit(0);
  }
  if (parsed.error) {
    console.error(parsed.error.message);
    process.exit(parsed.error.code);
  }

  const result = await runGate(parsed.args);

  if (parsed.args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(renderTerminal(result) + '\n');
  }

  if (result.gate.failed) process.exit(1);
}

// Only run when invoked as a binary — importing this module (e.g. in tests) is
// side-effect-free. Resolve symlinks on both sides so it still fires when run
// through a symlinked bin (npm link, `npm i -g`, npx), where argv[1] is the link.
export function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMainModule()) {
  main().catch((e) => {
    console.error(`gate: ${e?.stack ?? e}`);
    process.exit(2);
  });
}
