import type { CoordinationRef } from '@skaro/core';
import type { MethodName } from '../shared/ipc';

interface CommandDefinition {
  mode: 'mutation' | 'control' | 'observation';
  subject?: CoordinationRef['kind'];
  returnsValue?: boolean;
  priorityStop?: boolean;
}

/** Explicit project commands. Send delivery belongs exclusively to OwnerCommands. */
export const SESSION_COMMANDS = {
  'c4.audit': { mode: 'observation', returnsValue: true },
  'c4.auditStart': { mode: 'mutation', returnsValue: true },
  'c4.auditStop': { mode: 'control', priorityStop: true, returnsValue: true },
  'c4.auditRecover': { mode: 'control', returnsValue: true },
  'incidents.list': { mode: 'observation', returnsValue: true },
  'incidents.policy': { mode: 'observation', returnsValue: true },
  'incidents.setPolicy': { mode: 'control', returnsValue: true },
  'incidents.recheck': { mode: 'control' },
  'incidents.answer': { mode: 'control' },
  'incidents.revoke': { mode: 'control' },
  'incidents.cancel': { mode: 'control' },
  'local.register': { mode: 'mutation', returnsValue: true },
  'local.install': { mode: 'mutation', returnsValue: true },
  'local.rollback': { mode: 'control', returnsValue: true },
  'local.prepareCandidate': { mode: 'mutation', returnsValue: true },
  'local.candidate': { mode: 'observation', returnsValue: true },
  'c4.decide': { mode: 'mutation', subject: 'decision' },
  'plan.archiveGroup': { mode: 'mutation' },
  'tasks.reorder': { mode: 'mutation', subject: 'task' },
  'tasks.run': { mode: 'mutation' },
  'tasks.archive': { mode: 'mutation' },
  'tasks.delete': { mode: 'mutation' },
  'tasks.move': { mode: 'mutation' },
  'tasks.unblock': { mode: 'mutation' },
  'tasks.cancel': { mode: 'control', subject: 'task', priorityStop: true },
  'tasks.merge': { mode: 'mutation', subject: 'task' },
  'tasks.assign': { mode: 'mutation' },
  'stages.run': { mode: 'mutation', subject: 'task' },
  'stages.stop': { mode: 'control', subject: 'task', priorityStop: true },
  'docs.write': { mode: 'mutation', subject: 'document' },
  'docs.create': { mode: 'mutation', returnsValue: true },
  'docs.createSpec': { mode: 'mutation', returnsValue: true },
  'docs.setAdrStatus': { mode: 'mutation', subject: 'document' },
  'docs.setSpecStatus': { mode: 'mutation', subject: 'document' },
  'plan.delete': { mode: 'mutation' },
  'plan.reorder': { mode: 'mutation' },
  'plan.placeTask': { mode: 'mutation', subject: 'task' },
  'task.open': { mode: 'observation', subject: 'task', returnsValue: true },
  'task.respond': { mode: 'control', subject: 'task' },
  'task.interrupt': { mode: 'control', subject: 'task', priorityStop: true },
  'task.clear': { mode: 'mutation', subject: 'task' },
  'task.stopBackground': { mode: 'control', subject: 'task', priorityStop: true },
  'task.setSettings': { mode: 'mutation', subject: 'task' },
  'task.merge': { mode: 'mutation', subject: 'task' },
  'task.revertMerge': { mode: 'mutation', subject: 'task' },
  'task.toggleCriterion': { mode: 'mutation', subject: 'task' },
  'chat.open': { mode: 'observation', subject: 'chat', returnsValue: true },
  'chat.create': { mode: 'mutation', returnsValue: true },
  'chat.respond': { mode: 'control', subject: 'chat' },
  'chat.interrupt': { mode: 'control', subject: 'chat', priorityStop: true },
  'chat.setSettings': { mode: 'mutation', subject: 'chat' },
  'chat.archive': { mode: 'control', subject: 'chat' },
  'chat.clear': { mode: 'mutation', subject: 'chat' },
  'chat.proposal': { mode: 'mutation', subject: 'chat' },
} satisfies Partial<Record<MethodName, CommandDefinition>>;

const PROJECT_COMMANDS = {
  'project.saveSettings': { mode: 'mutation' },
  'project.rename': { mode: 'mutation', returnsValue: true },
  'project.removeLogo': { mode: 'mutation', returnsValue: true },
  'projects.remove': { mode: 'mutation' },
  'projects.relocate': { mode: 'mutation', returnsValue: true },
  'import.start': { mode: 'mutation', returnsValue: true },
  'import.review': { mode: 'observation', subject: 'chat', returnsValue: true },
} satisfies Partial<Record<MethodName, CommandDefinition>>;

export function sessionCommand(method: MethodName, args: readonly unknown[], id: string) {
  const definition: CommandDefinition | undefined =
    SESSION_COMMANDS[method as keyof typeof SESSION_COMMANDS] ??
    PROJECT_COMMANDS[method as keyof typeof PROJECT_COMMANDS];
  if (!definition) return;
  const projectId =
    method === 'tasks.reorder'
      ? (args[0] as { projectId?: unknown } | undefined)?.projectId
      : args[0];
  if (typeof projectId !== 'string' || !projectId.trim())
    throw new Error('A project command requires an explicit project');
  const subject: CoordinationRef = definition.subject
    ? { kind: definition.subject, id: requireSubject(args[1]) }
    : { kind: 'command', id };
  const mode = method === 'chat.archive' && args[2] === false ? 'mutation' : definition.mode;
  return { ...definition, mode, projectId, subject };
}

export function sessionCommandScope(
  command: NonNullable<ReturnType<typeof sessionCommand>>,
  id: string,
): string {
  if (command.priorityStop) return `stop:${id}`;
  return command.mode === 'mutation'
    ? 'project'
    : `${command.mode}:${command.subject.kind}:${command.subject.id}`;
}

function requireSubject(value: unknown): string {
  if (typeof value !== 'string' || !value.trim())
    throw new Error('A project command requires an explicit subject');
  return value;
}
