import type { AppDb, OwnerCommand } from '@skaro/core';
import { coordinationHash } from './project-coordinator-request';
import { requireCoordinationDispatch } from './coordination-dispatch';
interface CommandOrigin {
  projectId: string;
  inputHash: string;
  dispatchRevision: number;
}
const key = (id: string) => `coordination.owner-origin.${id}`;
const hash = (command: OwnerCommand) =>
  coordinationHash([command.method, command.owner, command.args]);
function origin(db: AppDb, command: OwnerCommand): CommandOrigin | undefined {
  const value = db.getSetting<CommandOrigin | undefined>(key(command.id), undefined, {
    strict: true,
  });
  if (value === undefined) return;
  if (
    value?.projectId !== command.args[0] ||
    value?.inputHash !== hash(command) ||
    !Number.isSafeInteger(value?.dispatchRevision) ||
    value.dispatchRevision < 0
  )
    throw new Error('Owner command origin changed');
  return value;
}
function legacyOrigin(db: AppDb, command: OwnerCommand) {
  const op = db.coordination.getOperation(String(command.args[0]), `owner-command:${command.id}`);
  if (
    !op ||
    op.mode !== 'delivery' ||
    op.action !== `owner.${command.method}` ||
    op.subject.id !== command.args[1] ||
    op.inputHash !== coordinationHash(command.args)
  )
    return false;
  const intent = db.coordination.getIntent(op.projectId, op.intentId);
  return intent?.source.kind === 'owner' && intent.source.id === command.id;
}
export function registerOwnerOrigin(db: AppDb, command: OwnerCommand) {
  const projectId = String(command.args[0]),
    dispatch = requireCoordinationDispatch(db, projectId);
  const previous = origin(db, command);
  if (previous) requireCoordinationDispatch(db, projectId, previous.dispatchRevision);
  else if (
    !db.settings.compareAndSet(key(command.id), undefined, {
      projectId,
      inputHash: hash(command),
      dispatchRevision: dispatch.revision,
    })
  )
    throw new Error('Owner command origin changed');
}
export function requireOwnerOrigin(db: AppDb, command: OwnerCommand) {
  const saved = origin(db, command);
  if (!saved && !legacyOrigin(db, command))
    throw new Error('Legacy owner command has no verified coordination intent');
  requireCoordinationDispatch(db, String(command.args[0]), saved?.dispatchRevision);
}
export function hasOwnerOrigin(db: AppDb, command: OwnerCommand) {
  try {
    return !!origin(db, command) || legacyOrigin(db, command);
  } catch {
    return false;
  }
}
