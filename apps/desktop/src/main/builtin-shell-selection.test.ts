import { expect, it } from 'vitest';
import { commandInvocation } from '@skaro/agent-runtime/shell';

it('selects only exact platform shells and keeps the command as a single argument', () => {
  const script = 'printf "%s" "$HOME"; exit 7';
  if (process.platform === 'win32') {
    expect(() => commandInvocation(script, 'sh')).toThrow();
    expect(commandInvocation(script, 'powershell').shell).toBe(false);
  } else {
    expect(commandInvocation(script, 'bash')).toEqual({
      command: '/bin/bash',
      args: ['-c', script],
      shell: false,
    });
    expect(commandInvocation(script, 'sh')).toEqual({
      command: '/bin/sh',
      args: ['-c', script],
      shell: false,
    });
    expect(() => commandInvocation(script, 'cmd')).toThrow();
  }
  expect(() => commandInvocation(script, 'unknown')).toThrow();
});
