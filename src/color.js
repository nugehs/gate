// Zero-dependency ANSI color, matching the rest of the nugehs toolchain.
// Honors NO_COLOR and falls back to plain text when stdout is not a TTY.

const enabled = !process.env.NO_COLOR && process.stdout.isTTY === true;

const wrap = (open, close) => (s) => (enabled ? `[${open}m${s}[${close}m` : String(s));

export const color = {
  enabled,
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  dim: wrap(2, 22),
  bold: wrap(1, 22),
};
