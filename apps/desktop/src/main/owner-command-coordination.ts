import type { AppDb, CoordinationEvidence, CoordinationRef, OwnerCommand } from '@skaro/core';
import type { ProjectCoordinators } from './project-coordinators';
import { coordinationHash } from './project-coordinator-request';
import { savedOwnerCommand } from './owner-command-evidence';
import { requireOwnerOrigin } from './owner-command-provenance';
import { requireNativeTaskStopProof } from './native-task-stop-proof';

/** Links the existing inbox to project admission, without another delivery queue. */
export class OwnerCommandCoordination {
  private readonly db: AppDb;
  private readonly coordinators: ProjectCoordinators;
  private readonly dataDir: string;
  constructor(db: AppDb, coordinators: ProjectCoordinators, dataDir: string) {
    this.db = db;
    this.coordinators = coordinators;
    this.dataDir = dataDir;
  }
  validate(projectId: string): void {
    this.coordinators.version(projectId);
  }
  stopping(): boolean {
    return this.coordinators.stopping();
  }
  uncertain(command: OwnerCommand): boolean {
    const [projectId] = command.args as [string];
    return (
      this.db.coordination.getOperation(projectId, this.operationId(command))?.state === 'uncertain'
    );
  }
  unresolved(projectId?: string): OwnerCommand[] {
    const projects = projectId ? [{ id: projectId }] : this.db.shell.list();
    return projects.flatMap((project) =>
      this.db.coordination.pending(project.id).flatMap((operation) => {
        if (operation.state !== 'uncertain' || !operation.id.startsWith('owner-command:'))
          return [];
        const command = this.db.commands.get(operation.id.slice('owner-command:'.length));
        return command && command.args[0] === project.id ? [command] : [];
      }),
    );
  }
  prior(command: OwnerCommand): OwnerCommand[] {
    return this.unresolved(String(command.args[0])).filter(
      (other) => other.id !== command.id && other.owner === command.owner,
    );
  }
  deliver(command: OwnerCommand, effect: () => Promise<void>): Promise<void> {
    const [projectId, ownerId] = command.args as [string, string];
    const kind = command.method === 'chat.send' ? 'chat' : 'task';
    return this.coordinators.execute(
      {
        id: this.operationId(command),
        projectId,
        action: `owner.${command.method}`,
        source: { kind: 'owner', id: command.id },
        subject: { kind, id: ownerId },
        inputHash: coordinationHash(command.args),
        mode: 'delivery',
        scopeKey: `delivery:${kind}:${ownerId}`,
      },
      effect,
      {
        validate: () => requireOwnerOrigin(this.db, command),
        evidence: () =>
          this.evidence(
            command,
            this.db.commands.get(command.id)?.state === 'cancelled'
              ? 'owner_delivery_cancelled'
              : 'owner_delivery_acknowledged',
          ),
        outcome: () =>
          this.db.commands.get(command.id)?.state === 'cancelled' ? 'failed' : 'succeeded',
        replay: () => undefined,
      },
    );
  }
  async reconcile(command: OwnerCommand): Promise<boolean> {
    const [projectId] = command.args as [string];
    this.validate(projectId);
    if (!(await savedOwnerCommand(this.db, this.dataDir, command))) return false;
    const id = this.operationId(command);
    if (this.db.coordination.getOperation(projectId, id)?.state === 'uncertain')
      await this.coordinators.reconcile(
        projectId,
        id,
        this.evidence(command, 'owner_native_echo'),
        'succeeded',
      );
    return true;
  }
  stopped(command: OwnerCommand, proof: CoordinationRef): void {
    const [projectId, ownerId] = command.args as [string, string];
    this.validate(projectId);
    if (command.method === 'chat.send') {
      if (
        proof.kind !== 'chat' ||
        proof.id !== ownerId ||
        this.db.getChat(ownerId)?.projectId !== projectId
      )
        throw new Error('Confirmed stop belongs to another chat');
    } else {
      const run = proof.kind === 'run' ? this.db.getRun(proof.id) : undefined;
      if (command.method !== 'task.send' || run?.projectId !== projectId || run.taskId !== ownerId)
        throw new Error('Confirmed stop belongs to another task runtime');
      if (run.agent !== 'skaro') requireNativeTaskStopProof(this.db, run, proof);
    }
    const id = this.operationId(command);
    const operation = this.db.coordination.getOperation(projectId, id);
    if (operation?.state === 'queued')
      this.db.coordination.reject(projectId, id, {
        expectedRevision: operation.revision,
        evidence: {
          code: 'owner_delivery_stopped',
          refs: [{ kind: 'command', id: command.id }, proof],
        },
      });
    else if (operation?.state === 'dispatching')
      throw new Error('Stopped delivery is still dispatching');
    else if (operation?.state === 'uncertain')
      this.coordinators.reconcile(
        projectId,
        id,
        {
          code: 'owner_delivery_stopped',
          refs: [{ kind: 'command', id: command.id }, proof],
        },
        'failed',
      );
  }
  private operationId(command: OwnerCommand): string {
    return `owner-command:${command.id}`;
  }
  private evidence(command: OwnerCommand, code: string): CoordinationEvidence {
    return { code, refs: [{ kind: 'command', id: command.id }] };
  }
}
