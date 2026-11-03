import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { startToolSession } from './builtin-tools-support';

it('delivers explicit task variables to a real supervised command, without storing values in primary config', async () => {
  const environment = {
    SKARO_ENV_NAME: 'scoped-command-environment',
    TASK_WORKING_ROOT: process.cwd(),
  };
  const current = await startToolSession('full', false, environment);
  try {
    const start = await current.tool('exec_command', {
      command:
        'node -e "process.stdout.write(JSON.stringify({name:process.env.SKARO_ENV_NAME,root:process.env.TASK_WORKING_ROOT,keys:Object.keys(process.env)}))"',
      shell: process.platform === 'win32' ? 'cmd' : 'sh',
      yieldMs: 1000,
    });
    let result = start;
    await expect
      .poll(
        async () => {
          result = await current.tool('write_stdin', { processId: start.processId, yieldMs: 100 });
          return result.state;
        },
        { timeout: 15000 },
      )
      .toBe('exited');
    expect(result.exitCode).toBe(0);
    const output = JSON.parse(String(result.output)) as {
      name: string;
      root: string;
      keys: string[];
    };
    expect(output.name).toBe(environment.SKARO_ENV_NAME);
    expect(output.root).toBe(environment.TASK_WORKING_ROOT);
    expect(output.keys.join(',')).not.toMatch(
      /OPENAI|ANTHROPIC|DEEPSEEK|OPENROUTER|CODEX_|CLAUDE_|SKARO_COMMAND_|ELECTRON_RUN_AS_NODE/i,
    );
    const records = (await readFile(join(current.directory, 'session.jsonl'), 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const config = records[0].facts.find(
      (fact: { type: string }) => fact.type === 'created',
    ).config;
    expect(config.tools.commandEnvironmentRevision).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(config)).not.toContain(environment.SKARO_ENV_NAME);
  } finally {
    await current.close();
  }
}, 60000);
