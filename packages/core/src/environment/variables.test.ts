import { describe, expect, it } from 'vitest';
import { allocatePorts } from './ports.ts';
import { environmentName, environmentVariables, expand } from './variables.ts';

const identity = {
  name: 'skaro-chatballs-t-026',
  root: 'C:\\Projects\\chatballs',
  worktree: 'C:\\Data\\worktrees\\p1\\T-026',
  ports: { API_PORT: 20000, UI_PORT: 20001 },
};

describe('task environment identity', () => {
  it('names the environment as a compose project of the task', () => {
    expect(environmentName('Chatballs', 'T-026')).toBe('skaro-chatballs-t-026');
    expect(environmentName('Мой проект', 'T-1')).toBe('skaro-project-t-1');
  });

  it('gives commands and the agent shell the same project name, ports and variables', () => {
    expect(expand('http://localhost:{UI_PORT}/{name} {other}', identity)).toBe(
      'http://localhost:20001/skaro-chatballs-t-026 {other}',
    );
    expect(
      environmentVariables(identity, {
        ports: ['API_PORT', 'UI_PORT'],
        env: { COMPOSE_FILE: 'compose.yaml|{root}/compose.task.yaml', IMAGE: 'app:{name}' },
        start: 'up',
        urls: {},
      }),
    ).toEqual({
      COMPOSE_PROJECT_NAME: 'skaro-chatballs-t-026',
      SKARO_ENV_NAME: 'skaro-chatballs-t-026',
      API_PORT: '20000',
      UI_PORT: '20001',
      COMPOSE_FILE: 'compose.yaml|C:/Projects/chatballs/compose.task.yaml',
      IMAGE: 'app:skaro-chatballs-t-026',
    });
  });

  it('allocates ports that are free now and promised to no other environment', async () => {
    const busy = new Set([20001]);
    const ports = await allocatePorts(3, new Set([20000, 20003]), async (p) => !busy.has(p));
    expect(ports).toEqual([20002, 20004, 20005]);
  });
});
