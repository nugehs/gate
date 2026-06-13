import { color } from '../color.js';
import { STATUS } from '../verdict.js';

const ICON = {
  [STATUS.PASS]: () => color.green('✓'),
  [STATUS.WARN]: () => color.yellow('⚠'),
  [STATUS.FAIL]: () => color.red('✗'),
  [STATUS.UNKNOWN]: () => color.yellow('?'),
  [STATUS.SKIPPED]: () => color.dim('·'),
  [STATUS.ERROR]: () => color.red('!'),
};

const STATUS_WORD = {
  [STATUS.PASS]: (s) => color.green(s),
  [STATUS.WARN]: (s) => color.yellow(s),
  [STATUS.FAIL]: (s) => color.red(s),
  [STATUS.UNKNOWN]: (s) => color.yellow(s),
  [STATUS.SKIPPED]: (s) => color.dim(s),
  [STATUS.ERROR]: (s) => color.red(s),
};

function pad(s, n) {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

export function renderTerminal(result) {
  const lines = [];
  lines.push('');
  lines.push(`  ${color.bold('gate')} ${color.dim('·')} ${result.repo.root}`);
  lines.push('');

  const labelWidth = Math.max(...result.domains.map((d) => d.label.length), 0);
  for (const d of result.domains) {
    const icon = (ICON[d.status] ?? ICON[STATUS.ERROR])();
    const word = (STATUS_WORD[d.status] ?? STATUS_WORD[STATUS.ERROR])(pad(d.status, 8));
    lines.push(`  ${icon}  ${color.bold(pad(d.label, labelWidth))}  ${word}  ${color.dim(d.summary)}`);
  }

  lines.push('');
  const v = result.verdict;
  const verdictWord =
    v === STATUS.FAIL ? color.red(color.bold('FAIL')) : v === STATUS.WARN ? color.yellow(color.bold('WARN')) : color.green(color.bold('PASS'));

  const c = result.summary;
  const tail = [];
  if (c.fail) tail.push(`${c.fail} blocking`);
  if (c.warn) tail.push(`${c.warn} warn`);
  if (c.unknown) tail.push(`${c.unknown} unknown`);
  if (c.error) tail.push(`${c.error} error`);
  if (c.skipped) tail.push(`${c.skipped} skipped`);
  const tailStr = tail.length ? color.dim(` — ${tail.join(' · ')}`) : '';

  if (result.gate.nothingChecked) {
    lines.push(`  verdict: ${color.yellow(color.bold('NO CHECKS RAN'))}${color.dim(' — every domain was skipped or deselected')}`);
  } else {
    lines.push(`  verdict: ${verdictWord}${tailStr}`);
  }

  if (result.gate.failed) {
    lines.push('');
    lines.push(`  ${color.red('✗ gate failed')}`);
    for (const r of result.gate.reasons) lines.push(`    ${color.dim('•')} ${r}`);
  }
  lines.push('');
  return lines.join('\n');
}
