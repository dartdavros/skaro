import { expect, it } from 'vitest';
import { commandTail } from './command-tail';

it('keeps the whole output through forty lines, then preserves exactly the last forty', () => {
  expect(commandTail('')).toEqual({ text: '', truncated: false });
  const lines = Array.from({ length: 41 }, (_, n) => `line-${n}`);
  const forty = lines.slice(0, 40).join('\n');
  expect(commandTail(forty)).toEqual({ text: forty, truncated: false });
  expect(commandTail(lines.join('\n'))).toEqual({
    text: lines.slice(1).join('\n'),
    truncated: true,
  });
  expect(commandTail('first\n\nlast', 2)).toEqual({ text: '\nlast', truncated: true });
});
