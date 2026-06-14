// Headless activation smoke test: inject a fake `vscode`, run the real compiled
// activate(), and exercise the AI surfaces + cockpit end-to-end. This catches
// runtime wiring bugs (bad command ids, missing registrations, render throws)
// that the type-checker can't, without needing a live editor.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const vscodeMock = require('./vscode-mock.js');
const rec = vscodeMock.__;

// Intercept `require('vscode')` for the extension and its modules.
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'vscode') return vscodeMock;
  return origLoad.call(this, request, parent, isMain);
};

const extension = require('../out/extension.js');

const ctxState = new Map();
const context = {
  subscriptions: [],
  extensionPath: '/fake/ext',
  extensionUri: vscodeMock.Uri.file('/fake/ext'),
  workspaceState: {
    get: (k, d) => (ctxState.has(k) ? ctxState.get(k) : d),
    update: (k, v) => {
      ctxState.set(k, v);
      return Promise.resolve();
    },
  },
};

// Activate once (no workspace folders → check() early-returns, nothing spawns).
let activateError = null;
try {
  extension.activate(context);
} catch (e) {
  activateError = e;
}

test('activate() runs without throwing and registers disposables', () => {
  assert.equal(activateError, null);
  assert.ok(context.subscriptions.length > 5);
});

test('all commands are registered', () => {
  for (const id of [
    'gate.check',
    'gate.refresh',
    'gate.showOutput',
    'gate.focusCockpit',
    'gate.muteFinding',
    'gate.clearMutes',
    'gate.installEngine',
  ]) {
    assert.equal(typeof rec.commands[id], 'function', `missing command: ${id}`);
  }
});

test('views, diagnostics and the three providers are wired', () => {
  assert.ok(rec.trees.some((t) => t.id === 'gate.verdict'));
  assert.ok(rec.webviews.some((w) => w.id === 'gate.cockpit'));
  assert.equal(rec.codeActionProviders.length, 1);
  assert.equal(rec.hoverProviders.length, 1);
  assert.equal(rec.codeLensProviders.length, 1);
  assert.ok(rec.saveHandlers.length >= 1);
});

test('AI surfaces are registered: tool, participant, mcp provider', () => {
  assert.ok(rec.tools['gate_check'], 'gate_check tool not registered');
  assert.ok(rec.participants['nugehs.gate'], 'chat participant not registered');
  assert.ok(rec.mcpProviders['nugehs-gate'], 'mcp provider not registered');
});

test('cockpit renders HTML when resolved', () => {
  const cockpit = rec.webviews.find((w) => w.id === 'gate.cockpit').provider;
  const view = { webview: { options: {}, html: '', onDidReceiveMessage: () => ({ dispose() {} }) } };
  cockpit.resolveWebviewView(view);
  assert.match(view.webview.html, /<!DOCTYPE html>/);
  assert.match(view.webview.html, /Re-check/);
  assert.match(view.webview.html, /No workspace folder open/); // no folders in this harness
});

test('chat participant streams a verdict', async () => {
  const handler = rec.participants['nugehs.gate'];
  const streamed = [];
  const stream = {
    markdown: (s) => streamed.push(typeof s === 'string' ? s : s.value),
    progress: () => {},
    button: () => {},
  };
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  await handler({ command: undefined, prompt: '' }, {}, stream, token);
  const text = streamed.join('');
  assert.match(text, /gate:/i);
  assert.match(text, /NONE/); // no folders → nothing to check
});

test('LM tool returns an actionable text verdict', async () => {
  const tool = rec.tools['gate_check'];
  const token = { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) };
  const result = await tool.invoke({ input: {} }, token);
  assert.ok(result && Array.isArray(result.parts));
  assert.match(result.parts[0].value, /gate verdict:/);
});

test('MCP provider yields a stdio definition that runs `gate mcp`', () => {
  const provider = rec.mcpProviders['nugehs-gate'];
  const defs = provider.provideMcpServerDefinitions();
  assert.equal(defs.length, 1);
  assert.ok(defs[0].args.includes('mcp'));
});

test('deactivate() is clean', () => {
  assert.doesNotThrow(() => extension.deactivate());
  Module._load = origLoad; // restore
});
