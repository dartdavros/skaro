import { expect, it } from 'vitest';
import { auditProcessRecoveryKey } from './c4-audit-process-recovery';

// Authorization metadata only, no process, model, backend or filesystem fixture.
it('admits only the retained process of the exact durable audit owner', () => {
  const lease = {
    projectId: 'project',
    ownerId: 'chat:original',
    checkpoint: 'process:chat.original',
    state: 'retained' as const,
  };
  const chat = { id: 'original', projectId: 'project' };
  expect(auditProcessRecoveryKey('project', lease, chat, 'original-audit')).toBe('chat.original');
  for (const marker of [undefined, null, '', {}, true])
    expect(auditProcessRecoveryKey('project', lease, chat, marker)).toBeUndefined();
  for (const wrong of [
    { ...lease, projectId: 'other' },
    { ...lease, ownerId: 'chat:other' },
    { ...lease, checkpoint: 'model' },
    { ...lease, checkpoint: 'process:chat.other' },
    { ...lease, state: 'granted' as const },
  ])
    expect(auditProcessRecoveryKey('project', wrong, chat, 'original-audit')).toBeUndefined();
  expect(auditProcessRecoveryKey('project', lease, undefined, 'original-audit')).toBeUndefined();
  expect(
    auditProcessRecoveryKey('project', lease, { ...chat, projectId: 'other' }, 'original-audit'),
  ).toBeUndefined();
});
