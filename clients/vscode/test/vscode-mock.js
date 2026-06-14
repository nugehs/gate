// A minimal fake of the `vscode` module — just enough surface to run the real
// activate() and exercise the cockpit, chat participant, LM tool and MCP provider
// in plain node:test, with no editor. Every registration is recorded in `__` so
// the activation test can assert on it and invoke captured handlers.

const rec = {
  commands: {},
  executed: [],
  trees: [],
  webviews: [],
  terminals: [],
  codeActionProviders: [],
  hoverProviders: [],
  codeLensProviders: [],
  saveHandlers: [],
  folderHandlers: [],
  tools: {},
  mcpProviders: {},
  participants: {},
};

class EventEmitter {
  constructor() {
    this.listeners = [];
  }
  get event() {
    return (fn) => {
      this.listeners.push(fn);
      return { dispose() {} };
    };
  }
  fire(e) {
    for (const l of this.listeners) l(e);
  }
  dispose() {}
}

class Range {
  constructor(...a) {
    this.args = a;
  }
}
class Diagnostic {
  constructor(range, message, severity) {
    Object.assign(this, { range, message, severity });
  }
}
class ThemeIcon {
  constructor(id, color) {
    this.id = id;
    this.color = color;
  }
}
class ThemeColor {
  constructor(id) {
    this.id = id;
  }
}
class TreeItem {
  constructor(label, collapsibleState) {
    this.label = label;
    this.collapsibleState = collapsibleState;
  }
}
class CodeAction {
  constructor(title, kind) {
    this.title = title;
    this.kind = kind;
  }
}
class MarkdownString {
  constructor(value, supportThemeIcons) {
    this.value = value || '';
    this.supportThemeIcons = supportThemeIcons;
    this.isTrusted = false;
  }
  appendMarkdown(s) {
    this.value += s;
    return this;
  }
}
class Hover {
  constructor(contents) {
    this.contents = contents;
  }
}
class CodeLens {
  constructor(range, command) {
    this.range = range;
    this.command = command;
  }
}
class LanguageModelToolResult {
  constructor(parts) {
    this.parts = parts;
  }
}
class LanguageModelTextPart {
  constructor(value) {
    this.value = value;
  }
}
class McpStdioServerDefinition {
  constructor(label, command, args, env, version) {
    Object.assign(this, { label, command, args, env, version });
  }
}

const Uri = {
  file: (p) => ({ scheme: 'file', fsPath: p, path: p, toString: () => 'file://' + p }),
  parse: (s) => ({ scheme: 'parsed', fsPath: s, toString: () => s }),
  joinPath: (base, ...segs) => ({ fsPath: [base.fsPath, ...segs].join('/'), toString: () => [base.fsPath, ...segs].join('/') }),
};

const window = {
  createOutputChannel: (name) => ({ name, appendLine() {}, show() {}, dispose() {} }),
  createStatusBarItem: () => ({ text: '', tooltip: '', command: '', show() {}, hide() {}, dispose() {} }),
  registerTreeDataProvider: (id, provider) => {
    rec.trees.push({ id, provider });
    return { dispose() {} };
  },
  registerWebviewViewProvider: (id, provider) => {
    rec.webviews.push({ id, provider });
    return { dispose() {} };
  },
  createTerminal: (name) => {
    rec.terminals.push(name);
    return { show() {}, sendText() {} };
  },
};

const languages = {
  createDiagnosticCollection: (name) => ({ name, clear() {}, set() {}, delete() {}, dispose() {} }),
  registerCodeActionsProvider: (_sel, provider) => {
    rec.codeActionProviders.push(provider);
    return { dispose() {} };
  },
  registerHoverProvider: (_sel, provider) => {
    rec.hoverProviders.push(provider);
    return { dispose() {} };
  },
  registerCodeLensProvider: (_sel, provider) => {
    rec.codeLensProviders.push(provider);
    return { dispose() {} };
  },
};

const commands = {
  registerCommand: (id, fn) => {
    rec.commands[id] = fn;
    return { dispose() {} };
  },
  executeCommand: (id, ...args) => {
    rec.executed.push({ id, args });
    return Promise.resolve();
  },
};

const workspace = {
  workspaceFolders: undefined,
  getConfiguration: () => ({ get: (_key, def) => def }),
  onDidSaveTextDocument: (fn) => {
    rec.saveHandlers.push(fn);
    return { dispose() {} };
  },
  onDidChangeWorkspaceFolders: (fn) => {
    rec.folderHandlers.push(fn);
    return { dispose() {} };
  },
};

const lm = {
  registerTool: (name, tool) => {
    rec.tools[name] = tool;
    return { dispose() {} };
  },
  registerMcpServerDefinitionProvider: (id, provider) => {
    rec.mcpProviders[id] = provider;
    return { dispose() {} };
  },
};

const chat = {
  createChatParticipant: (id, handler) => {
    rec.participants[id] = handler;
    return { id, iconPath: undefined, dispose() {} };
  },
};

module.exports = {
  __: rec,
  EventEmitter,
  Range,
  Diagnostic,
  ThemeIcon,
  ThemeColor,
  TreeItem,
  CodeAction,
  MarkdownString,
  Hover,
  CodeLens,
  LanguageModelToolResult,
  LanguageModelTextPart,
  McpStdioServerDefinition,
  Uri,
  window,
  languages,
  commands,
  workspace,
  lm,
  chat,
  StatusBarAlignment: { Left: 1, Right: 2 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  CodeActionKind: { QuickFix: { value: 'quickfix' } },
};
