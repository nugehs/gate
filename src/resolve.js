// Find each tool's CLI entrypoint without hard-coding install layout.
//
// Resolution order, first hit wins:
//   1. GATE_<TOOL>_BIN env var  — explicit override (CI, exotic installs)
//   2. node_modules             — the published @nugehs/<tool> dependency
//   3. sibling checkout         — ../<tool> next to this repo (local dev)
//
// This lets gate work both as a published package (deps resolve from
// node_modules) and straight from a clone sitting alongside the four tools.

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {{tool:string, pkg:string, binRel:string, binName?:string}} spec
 * @param {{root?:string}} [opts] - override the repo root the sibling fallback is
 *   resolved against (defaults to this package's root; injectable for tests).
 * @returns {{entry:string, source:'env'|'node_modules'|'sibling'}|null}
 */
export function resolveTool({ tool, pkg, binRel, binName }, { root = ROOT } = {}) {
  const envKey = `GATE_${tool.toUpperCase()}_BIN`;
  const override = process.env[envKey];
  if (override && fs.existsSync(override)) {
    return { entry: override, source: 'env' };
  }

  try {
    const pkgJsonPath = require.resolve(`${pkg}/package.json`);
    const dir = path.dirname(pkgJsonPath);
    const meta = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
    const bin =
      typeof meta.bin === 'string'
        ? meta.bin
        : (meta.bin && (meta.bin[binName] ?? Object.values(meta.bin)[0]));
    if (bin) {
      const entry = path.join(dir, bin);
      if (fs.existsSync(entry)) return { entry, source: 'node_modules' };
    }
  } catch {
    // not installed — fall through to the sibling checkout
  }

  const sibling = path.resolve(root, '..', tool, binRel);
  if (fs.existsSync(sibling)) return { entry: sibling, source: 'sibling' };

  return null;
}
