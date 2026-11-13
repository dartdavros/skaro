import { expect, it } from 'vitest';
import { sessionCommand, sessionCommandScope } from './session-command-catalogue';

it('requires coordinated owner mutations for local installation and permits explicit rollback control', () => {
  for (const method of ['local.register', 'local.prepareCandidate', 'local.install'] as const)
    expect(sessionCommand(method, ['project', 'target'], 'owner')?.mode).toBe('mutation');
  expect(sessionCommand('local.candidate', ['project', 'candidate'], 'read')?.mode).toBe(
    'observation',
  );
  expect(sessionCommand('local.rollback', ['project', 'receipt'], 'undo')?.mode).toBe('control');
});

it('extracts the explicit range project without accepting an interchangeable argument shape', () => {
  expect(
    sessionCommand('tasks.reorder', [{ projectId: 'project' }, 'T-1'], 'command'),
  ).toMatchObject({ projectId: 'project', subject: { kind: 'task', id: 'T-1' } });
  expect(() => sessionCommand('tasks.reorder', ['project', 'T-1'], 'command')).toThrow();
  expect(() => sessionCommand('tasks.run', [{ projectId: 'project' }], 'command')).toThrow();
});

it('leaves message delivery to the inbox and admits interruption separately from mutations', () => {
  expect(sessionCommand('task.send', ['project', 'T-1'], 'command')).toBeUndefined();
  expect(sessionCommand('chat.send', ['project', 'chat'], 'command')).toBeUndefined();
  expect(sessionCommand('task.interrupt', ['project', 'T-1'], 'command')?.mode).toBe('control');
  expect(sessionCommand('chat.respond', ['project', 'chat'], 'command')?.mode).toBe('control');
  expect(sessionCommand('task.toggleCriterion', ['project', 'T-1'], 'command')?.mode).toBe(
    'mutation',
  );
  expect(sessionCommand('task.clear', ['project', 'T-1'], 'command')?.mode).toBe('mutation');
  expect(sessionCommand('chat.archive', ['project', 'chat', false], 'command')?.mode).toBe(
    'mutation',
  );
});

it('describes a command without copying document content or secret answers into its metadata', () => {
  const content = 'private document content';
  const answer = { kind: 'question', answers: { credential: ['secret answer'] } };
  const document = sessionCommand('docs.write', ['project', 'architecture.md', content], 'write');
  const response = sessionCommand(
    'chat.respond',
    ['project', 'chat', 'question', answer],
    'answer',
  );
  expect(JSON.stringify({ document, response })).not.toContain(content);
  expect(JSON.stringify({ document, response })).not.toContain('secret answer');
});

it('coordinates explicit project settings while leaving app-wide and native picker commands outside', () => {
  expect(sessionCommand('project.saveSettings', ['project', {}], 'settings')?.mode).toBe(
    'mutation',
  );
  expect(sessionCommand('projects.relocate', ['project', 'path'], 'relocate')?.projectId).toBe(
    'project',
  );
  expect(sessionCommand('app.setProjectDefaults', [{}], 'defaults')).toBeUndefined();
  expect(sessionCommand('project.pickLogo', ['project'], 'picker')).toBeUndefined();
});

it('a new explicit stop can pass uncertain earlier delivery, response, or stop operations', () => {
  const stop = sessionCommand('task.interrupt', ['project', 'T-1'], 'stop')!;
  const response = sessionCommand('task.respond', ['project', 'T-1'], 'answer')!;
  expect(sessionCommandScope(stop, 'first')).not.toBe(sessionCommandScope(response, 'answer'));
  expect(sessionCommandScope(stop, 'first')).not.toBe('delivery:task:T-1');
  expect(sessionCommandScope(stop, 'first')).not.toBe(sessionCommandScope(stop, 'second'));
  expect(sessionCommandScope(stop, 'first')).toBe(sessionCommandScope(stop, 'first'));
});
