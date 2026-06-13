import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { runGate } from './orchestrator.js';
import { ADAPTERS } from './adapters/index.js';

// Hand-rolled JSON-RPC 2.0 server over stdio — no SDK dependency, matching the
// aiglare/repoctx MCP server convention. Reads line-delimited JSON from stdin
// and writes responses to stdout.

const protocolVersion = '2025-06-18';
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));

const TOOL_NAMES = ADAPTERS.map((a) => a.tool);

const CHECK_DESCRIPTIONS = {
  aiglare:
    'AI/LLM governance guardrails — flags model output reaching a user or a side-effect without confidence handling, fallback, validation, or human-in-the-loop.',
  bouncer:
    "Static compliance-controls — verifies the controls a regulation requires (UK Online Safety Act, ICO Children's Code) actually exist in the code.",
  tieline: 'Frontend↔backend contract drift — frontend API calls that resolve to no backend route.',
  repoctx: 'Deterministic merge-readiness gate — secret safety, risk review, release discipline, required checks.',
};

const tools = [
  {
    name: 'gate_check',
    title: 'Run the unified gate',
    description:
      'Run aiglare, bouncer, tieline & repoctx against a repo and return one normalized verdict (pass|warn|fail), with each tool reduced to a status and the blocking reasons. The single "can this ship?" call for the nugehs toolchain.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Repository path. Defaults to the current working directory.' },
        only: {
          type: 'array',
          items: { type: 'string', enum: TOOL_NAMES },
          description: 'Run only these checks.',
        },
        skip: {
          type: 'array',
          items: { type: 'string', enum: TOOL_NAMES },
          description: 'Skip these checks.',
        },
        ci: { type: 'boolean', description: 'Compute gate.failed as a CI gate would (blocks on a fail verdict).' },
        strict: { type: 'boolean', description: 'Treat WARN/UNKNOWN as blocking too.' },
      },
    },
  },
  {
    name: 'list_checks',
    title: 'List the gate checks',
    description: 'List the four checks gate runs, each with the domain it covers and what it answers.',
    inputSchema: { type: 'object', properties: {} },
  },
];

async function dispatchTool(name, args) {
  switch (name) {
    case 'gate_check':
      return runGate({
        path: args.path,
        only: args.only ?? null,
        skip: args.skip ?? [],
        ci: args.ci ?? false,
        strict: args.strict ?? false,
      });
    case 'list_checks':
      return {
        checks: ADAPTERS.map((a) => ({
          tool: a.tool,
          domain: a.domain,
          label: a.label,
          description: CHECK_DESCRIPTIONS[a.tool] ?? '',
        })),
      };
    default:
      throw new McpProtocolError(-32602, `Unknown tool: ${name}`);
  }
}

export async function startMcpServer({ input = process.stdin, output = process.stdout } = {}) {
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      writeMessage(output, errorResponse(null, -32700, `Parse error: ${error.message}`));
      continue;
    }

    const response = await handleMessage(message);
    if (response) writeMessage(output, response);
  }
}

async function handleMessage(message) {
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return errorResponse(message?.id ?? null, -32600, 'Invalid JSON-RPC request');
  }

  try {
    switch (message.method) {
      case 'initialize':
        return successResponse(message.id, {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: packageJson.name, version: packageJson.version },
        });
      case 'notifications/initialized':
        return undefined;
      case 'ping':
        return successResponse(message.id, {});
      case 'tools/list':
        return successResponse(message.id, { tools });
      case 'tools/call':
        return successResponse(message.id, await callTool(message.params));
      default:
        return errorResponse(message.id, -32601, `Method not found: ${message.method}`);
    }
  } catch (error) {
    const code = error instanceof McpProtocolError ? error.code : -32603;
    return errorResponse(message.id, code, error instanceof Error ? error.message : String(error));
  }
}

async function callTool(params = {}) {
  if (!params || typeof params !== 'object') {
    throw new McpProtocolError(-32602, 'Tool call params must be an object');
  }

  const name = params.name;
  if (typeof name !== 'string' || !name.trim()) {
    throw new McpProtocolError(-32602, 'Tool name is required');
  }

  const args = params.arguments ?? {};
  if (!args || typeof args !== 'object' || Array.isArray(args)) {
    throw new McpProtocolError(-32602, 'Tool arguments must be an object');
  }

  let result;
  try {
    result = await dispatchTool(name, args);
  } catch (error) {
    if (error instanceof McpProtocolError) throw error;
    return {
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
    isError: false,
  };
}

function successResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function errorResponse(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

function writeMessage(output, message) {
  output.write(`${JSON.stringify(message)}\n`);
}

class McpProtocolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
