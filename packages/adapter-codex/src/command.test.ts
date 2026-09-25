import { describe, expect, it } from 'vitest';
import { displayCommand } from './projector.ts';

describe('displayCommand', () => {
  it('takes the single parsed action', () => {
    expect(
      displayCommand('"C:\\pwsh.exe" -Command "git status"', [
        { type: 'unknown', command: 'git status' },
      ]),
    ).toBe('git status');
  });

  it('unwraps the shell when there is no single action', () => {
    expect(
      displayCommand('"C:\\Users\\me\\pwsh.exe" -Command "node -e \\"console.log(1)\\""', []),
    ).toBe('node -e "console.log(1)"');
    expect(displayCommand("/bin/bash -lc 'npm test'", [])).toBe('npm test');
    expect(displayCommand('npm test', [])).toBe('npm test');
  });
});
