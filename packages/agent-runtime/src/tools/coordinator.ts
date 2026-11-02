import { createHash } from 'node:crypto';
import type { Interaction, InteractionAnswer } from '@skaro/timeline';
import { builtinSandboxStatus } from '@skaro/timeline';
import type { RuntimeJournal } from '../journal.ts';
import type { JournalRecord, RuntimeCommand, RuntimeFact } from '../model.ts';
import { ToolRegistry } from './registry.ts';
import { ToolAccessQueue } from './rw-lock.ts';
import { schemas, writeTools, isToolName } from './schemas.ts';
import type { RuntimeExtensionHost } from '../extensions/registry.ts';
import { UnknownToolOutcome } from './effect-error.ts';
import type { RuntimeVerificationHost } from '../verification/host.ts';
import { unresolvedOperationalEffects } from '../context/effect-boundary.ts';

export class ToolCoordinator {
  readonly registry: ToolRegistry;
  private readonly journal: RuntimeJournal;
  private readonly access = new ToolAccessQueue();
  private abort = new AbortController();
  private halted?: Error;
  private readonly active = new Map<string, { hash: string; work: Promise<JournalRecord> }>();
  private readonly answers = new Map<
    string,
    { resolve(answer: InteractionAnswer): void; reject(error: Error): void }
  >();
  private constructor(registry: ToolRegistry, journal: RuntimeJournal) {
    this.registry = registry;
    this.journal = journal;
  }
  static async create(
    journal: RuntimeJournal,
    host?: RuntimeExtensionHost,
    verification?: RuntimeVerificationHost,
    commandEnvironment?: Readonly<Record<string, string>>,
  ): Promise<ToolCoordinator | undefined> {
    const config = journal.state.config!.tools;
    if (!config) return undefined;
    const registry = await ToolRegistry.create(
      config,
      journal,
      host,
      verification,
      commandEnvironment,
    );
    await registry.processes.recover();
    return new ToolCoordinator(registry, journal);
  }
  execute(command: RuntimeCommand): Promise<JournalRecord> {
    if (this.halted) return Promise.reject(this.halted);
    const previous = this.active.get(command.id);
    const hash = createHash('sha256').update(JSON.stringify(command.action)).digest('hex');
    if (previous)
      return previous.hash === hash
        ? previous.work
        : Promise.reject(new Error('Command identity reused for different input'));
    const work = this.run(command).finally(() => this.active.delete(command.id));
    this.active.set(command.id, { hash, work });
    return work;
  }
  cancel(): void {
    this.abort.abort(new Error('Tool admission revoked'));
    for (const answer of this.answers.values()) answer.reject(new Error('Tool admission revoked'));
    this.answers.clear();
  }
  resume(): void {
    if (this.halted) throw this.halted;
    if (this.abort.signal.aborted) this.abort = new AbortController();
  }
  async interrupt(): Promise<void> {
    return this.shutdown(false);
  }
  async close(): Promise<void> {
    return this.shutdown(true);
  }
  private async shutdown(final: boolean): Promise<void> {
    this.cancel();
    try {
      const closed = await Promise.allSettled([
        this.registry.processes.close(),
        final ? this.registry.extensions.close() : this.registry.extensions.interrupt(),
      ]);
      if (closed.some((result) => result.status === 'rejected'))
        throw new Error('Tool process or extension shutdown was not confirmed');
    } catch (error) {
      this.halted =
        error instanceof Error ? error : new Error('Process shutdown was not confirmed');
    }
    await Promise.allSettled([...this.active.values()].map((entry) => entry.work));
    if (this.halted) throw this.halted;
  }
  answered(id: string, answer: InteractionAnswer): void {
    this.answers.get(id)?.resolve(answer);
    this.answers.delete(id);
  }
  private async waitFor(
    interaction: Interaction,
    recordId: string,
    signal: AbortSignal,
  ): Promise<InteractionAnswer> {
    const prior = this.journal.state.answered[interaction.id];
    if (prior) return prior;
    signal.throwIfAborted();
    const response = new Promise<InteractionAnswer>((resolve, reject) =>
      this.answers.set(interaction.id, { resolve, reject }),
    );
    void response.catch(() => undefined);
    if (!this.journal.state.interactions[interaction.id]) {
      await this.journal.append(recordId, [
        { type: 'interaction', interaction },
        { type: 'timeline', event: { t: 'interaction.opened', interaction } },
      ]);
    }
    return response;
  }
  private async authorize(
    id: string,
    name: string,
    args: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<void> {
    const state = this.journal.state;
    const config = state.config!;
    const extensionWrite =
      this.registry.extensions.has(name) && !this.registry.extensions.readOnly(name);
    if (state.stopped || state.closed)
      throw new Error('Session is stopped; explicit input must resume it');
    if (
      config.tools!.readOnly &&
      (extensionWrite ||
        name === 'apply_patch' ||
        name === 'exec_command' ||
        name === 'run_check' ||
        (name === 'write_stdin' && (args.chars !== undefined || args.end === true)))
    )
      throw new Error('Read-only scope forbids this tool');
    if (
      (extensionWrite || (isToolName(name) && writeTools.has(name))) &&
      name !== 'stop_process' &&
      name !== 'update_plan' &&
      unresolvedOperationalEffects(this.journal).some(([, effect]) => effect.state === 'unknown')
    )
      throw new Error('An unknown effect outcome blocks new tools');
    const command =
      name === 'exec_command' ||
      name === 'run_check' ||
      (name === 'write_stdin' && (args.chars !== undefined || args.end === true));
    const writes = name === 'apply_patch';
    const requires =
      config.permissionMode !== 'full' &&
      (command || extensionWrite || (config.permissionMode === 'ask' && writes));
    if (!requires) return;
    const interaction: Interaction = {
      kind: 'approval',
      id: `approval-${id}`,
      action: {
        type: command ? 'command' : extensionWrite ? 'mcp' : 'file_write',
        title: name,
        ...(name === 'exec_command' || name === 'run_check'
          ? { command: String(args.command) }
          : {}),
        ...(name === 'apply_patch' ? { paths: [String(args.path)] } : {}),
        reason:
          builtinSandboxStatus(config.permissionMode).detail +
          (extensionWrite ? `\n${JSON.stringify(args)}` : ''),
      },
      choices: ['allow_once', 'deny'],
    };
    const answer = await this.waitFor(interaction, `approval:${id}`, signal);
    if (answer.kind !== 'approval' || answer.choice !== 'allow_once')
      throw new Error('Tool permission denied');
  }
  private async run(command: RuntimeCommand): Promise<JournalRecord> {
    if (command.action.type !== 'tool' || !/^[a-zA-Z0-9_-]{1,160}$/.test(command.id))
      throw new Error('Invalid tool command');
    const hash = createHash('sha256').update(JSON.stringify(command.action)).digest('hex');
    const key = `cmd:${command.id}`;
    const prior = this.journal.find(key);
    if (prior) {
      if (prior.requestHash !== hash)
        throw new Error('Command identity reused for different input');
      return prior;
    }
    const request = this.journal.state.toolRequests[command.id];
    if (request && request.hash !== hash)
      throw new Error('Tool identity reused for different input');
    const signal = this.abort.signal;
    let admitted = false;
    let value: unknown;
    let error: string | undefined;
    let unknown = false;
    try {
      const tool = this.registry.parse(command.action.name, command.action.args);
      signal.throwIfAborted();
      if (!request)
        await this.journal.append(`tool-request:${command.id}`, [
          { type: 'tool-request', id: command.id, hash, name: tool.name },
        ]);
      if (this.journal.state.effects[command.id])
        throw new Error(
          'Tool effect already has a recorded or unknown outcome; it will not be replayed',
        );
      await this.authorize(command.id, tool.name, tool.args, signal);
      signal.throwIfAborted();
      if (tool.name === 'ask_user') {
        const { questions } = schemas.ask_user.parse(tool.args);
        if (new Set(questions.map((question) => question.id)).size !== questions.length)
          throw new Error('Question IDs must be unique');
        value = await this.waitFor(
          { kind: 'question', id: `question-${command.id}`, questions },
          `question:${command.id}`,
          signal,
        );
      } else
        value = await this.access.run(
          this.registry.extensions.has(tool.name)
            ? !this.registry.extensions.readOnly(tool.name)
            : isToolName(tool.name) && writeTools.has(tool.name),
          signal,
          async () => {
            signal.throwIfAborted();
            await this.journal.append(`intent:${command.id}`, [
              { type: 'effect-intent', id: command.id, name: tool.name },
            ]);
            admitted = true;
            signal.throwIfAborted();
            return this.registry.execute(command.id, tool.name, tool.args, signal);
          },
        );
      if (
        this.registry.extensions.has(tool.name) &&
        value &&
        typeof value === 'object' &&
        (value as { isError?: boolean }).isError === true
      ) {
        error = String((value as { text?: string }).text ?? 'Extension reported a tool error');
      }
    } catch (failure) {
      unknown = failure instanceof UnknownToolOutcome;
      error = signal.aborted
        ? 'Tool admission revoked'
        : failure instanceof Error
          ? failure.message
          : 'Tool failed';
    }
    const facts: RuntimeFact[] = admitted
      ? unknown
        ? [{ type: 'effect-unknown', id: command.id }]
        : [{ type: 'effect-result', id: command.id, result: error ? { error } : value }]
      : [];
    return this.journal.append(key, facts, error ? { error } : { value }, hash);
  }
}
