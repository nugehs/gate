import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { startMcpServer } from '../src/mcp.js';

const here = path.dirname(fileURLToPath(import.meta.url));

// Drive the stdio server with a list of JSON-RPC requests; return parsed replies.
async function rpc(requests) {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks = [];
  output.on('data', (c) => chunks.push(c.toString('utf8')));

  const done = startMcpServer({ input, output });
  for (const req of requests) input.write(JSON.stringify(req) + '\n');
  input.end();
  await done;

  return chunks
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

test('initialize returns protocol version and server info', async () => {
  const [res] = await rpc([{ jsonrpc: '2.0', id: 1, method: 'initialize' }]);
  assert.equal(res.id, 1);
  assert.equal(res.result.protocolVersion, '2025-06-18');
  assert.equal(res.result.serverInfo.name, '@nugehs/gate');
  assert.ok(res.result.capabilities.tools);
});

test('tools/list advertises gate_check + list_checks', async () => {
  const [res] = await rpc([{ jsonrpc: '2.0', id: 2, method: 'tools/list' }]);
  const names = res.result.tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['gate_check', 'list_checks']);
});

test('list_checks returns the four domains', async () => {
  const [res] = await rpc([{ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'list_checks', arguments: {} } }]);
  const tools = res.result.structuredContent.checks.map((c) => c.tool).sort();
  assert.deepEqual(tools, ['aiglare', 'bouncer', 'repoctx', 'tieline']);
  assert.equal(res.result.isError, false);
});

test('gate_check returns a unified verdict for a repo', async () => {
  const [res] = await rpc([
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'gate_check', arguments: { path: path.join(here, 'fixtures'), only: ['aiglare'] } },
    },
  ]);
  const v = res.result.structuredContent;
  assert.equal(res.result.isError, false);
  assert.equal(v.schemaVersion, 1);
  assert.ok(['pass', 'warn', 'fail'].includes(v.verdict));
  assert.ok(Array.isArray(v.domains));
});

test('unknown tool → JSON-RPC error', async () => {
  const [res] = await rpc([{ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope', arguments: {} } }]);
  assert.equal(res.error.code, -32602);
});

test('unknown method → method not found', async () => {
  const [res] = await rpc([{ jsonrpc: '2.0', id: 6, method: 'does/not/exist' }]);
  assert.equal(res.error.code, -32601);
});
