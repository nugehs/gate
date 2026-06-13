#!/usr/bin/env node
import { runGate } from './orchestrator.js';
import { renderTerminal } from './report/terminal.js';
import { ADAPTERS } from './adapters/index.js';

const TOOLS = ADAPTERS.map((a) => a.tool);

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

Tool resolution (per tool, first hit wins):
  1. GATE_<TOOL>_BIN env var   2. installed @nugehs/<tool>   3. ../<tool> sibling checkout

Examples:
  gate                                  # audit the current repo
  gate ./service --ci                   # fail the build on a blocking verdict
  gate --only aiglare,repoctx --json    # just those two, machine-readable
  gate --skip tieline --strict          # everything but tieline, warnings block
`;

function parseList(v) {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseArgs(argv) {
  const args = { path: process.cwd(), json: false, ci: false, strict: false, only: null, skip: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(HELP);
      process.exit(0);
    } else if (a === '--json') {
      args.json = true;
    } else if (a === '--ci') {
      args.ci = true;
    } else if (a === '--strict') {
      args.strict = true;
    } else if (a === '--only') {
      args.only = parseList(argv[++i]);
    } else if (a === '--skip') {
      args.skip = parseList(argv[++i]);
    } else if (a.startsWith('-')) {
      console.error(`Unknown option: ${a}`);
      process.exit(2);
    } else {
      args.path = a;
    }
  }

  const known = new Set(TOOLS);
  for (const t of [...(args.only ?? []), ...args.skip]) {
    if (!known.has(t)) {
      console.error(`Unknown tool: ${t} (expected one of ${TOOLS.join(', ')})`);
      process.exit(2);
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await runGate(args);

  if (args.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } else {
    process.stdout.write(renderTerminal(result) + '\n');
  }

  if (result.gate.failed) process.exit(1);
}

main().catch((e) => {
  console.error(`gate: ${e?.stack ?? e}`);
  process.exit(2);
});
