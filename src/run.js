// Spawn a tool's CLI under the current node, capture stdout, and pull JSON out.

import { execFile } from 'node:child_process';

const MAX_BUFFER = 32 * 1024 * 1024; // tool reports can be large; never truncate

/**
 * Run a tool entrypoint and fully capture its output. Never rejects — a
 * non-zero exit is expected (these tools exit non-zero when they find
 * problems), and stdout/stderr are captured regardless of exit code.
 *
 * @returns {Promise<{exitCode:number|null, stdout:string, stderr:string, spawnError?:string, timedOut?:boolean}>}
 */
export function runTool(entry, args, { cwd, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [entry, ...args],
      { cwd, env: process.env, timeout: timeoutMs, maxBuffer: MAX_BUFFER },
      (err, stdout, stderr) => {
        if (!err) {
          resolve({ exitCode: 0, stdout, stderr });
          return;
        }
        if (err.killed) {
          resolve({ exitCode: null, stdout, stderr, timedOut: true });
          return;
        }
        // A normal non-zero exit surfaces as err.code === <number>; stdout/stderr
        // are still fully populated. Anything else (ENOENT, maxBuffer) is a real failure.
        if (typeof err.code === 'number') {
          resolve({ exitCode: err.code, stdout, stderr });
          return;
        }
        resolve({ exitCode: null, stdout, stderr, spawnError: String(err.message ?? err) });
      }
    );
  });
}

/**
 * Best-effort JSON extraction. Tools emit clean JSON under --json, but a stray
 * leading line shouldn't break us — fall back to the outermost {...} or [...].
 */
export function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    // fall through
  }
  const start = text.search(/[[{]/);
  if (start === -1) return null;
  const open = text[start];
  const close = open === '{' ? '}' : ']';
  const end = text.lastIndexOf(close);
  if (end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}
