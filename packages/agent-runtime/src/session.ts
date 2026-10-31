import { createHash, randomUUID } from 'node:crypto';
import { requireBuiltinCompatibility, validateModelEndpoint } from '@skaro/timeline';
import type { RouteSnapshot, RuntimeProcessIdentity } from '@skaro/timeline';
import { RuntimeJournal } from './journal.ts';
import { commandFacts } from './commands.ts';
import packageManifest from '../package.json' with { type: 'json' };
import type { JournalRecord, RuntimeCommand, RuntimeStart } from './model.ts';
import { ToolCoordinator } from './tools/coordinator.ts';
import { schemas } from './tools/schemas.ts';

function validateRoute(route: RouteSnapshot): void {
  if (
    route.schema !== 1 ||
    !route.routeId ||
    !route.modelId ||
    !route.connectionId ||
    !route.connector ||
    !route.apiProfile?.id ||
    !Number.isSafeInteger(route.routeRevision) ||
    route.routeRevision < 1 ||
    !Number.isSafeInteger(route.connectionRevision) ||
    route.connectionRevision < 1 ||
    !Number.isSafeInteger(route.apiProfile.revision) ||
    route.apiProfile.revision < 1
  )
    throw new Error('Invalid route snapshot');
  validateModelEndpoint(route.endpoint);
}

/** BA-2 lifecycle core. It deliberately has no provider or tool execution implementation. */
export class RuntimeSession {
  readonly journal: RuntimeJournal;
  private queue: Promise<unknown> = Promise.resolve();
  private ended = false;
  private disposing?: Promise<void>;
  private readonly inFlight = new Map<string, { hash: string; work: Promise<JournalRecord> }>();
  private tools?: ToolCoordinator;
  private constructor(journal: RuntimeJournal) {
    this.journal = journal;
  }

  static async open(config: RuntimeStart, owner: RuntimeProcessIdentity): Promise<RuntimeSession> {
    requireBuiltinCompatibility(config.versions);
    validateRoute(config.route);
    for (const route of config.availableRoutes ?? []) validateRoute(route);
    if (!['ask', 'auto', 'full'].includes(config.permissionMode))
      throw new Error('Unknown permission mode');
    const journal = await RuntimeJournal.open(config.journalPath, config.sessionId, owner);
    try {
      if (!journal.state.config) {
        await journal.append('created', [
          { type: 'created', config, runtimeVersion: packageManifest.version },
          {
            type: 'timeline',
            event: {
              t: 'session.started',
              nativeSessionId: config.sessionId,
              model: config.route.modelId,
              capabilities: {
                flags: ['lifecycle-core'],
                tools: config.tools ? Object.keys(schemas) : [],
              },
            },
          },
        ]);
      } else {
        if (journal.state.runtimeVersion !== packageManifest.version)
          throw new Error('Unsupported runtime journal version; explicit migration required');
        requireBuiltinCompatibility(journal.state.config.versions);
        if (JSON.stringify(journal.state.config.tools) !== JSON.stringify(config.tools))
          throw new Error('Resume tool scope differs from the persisted host scope');
        if (JSON.stringify(journal.state.config.route) !== JSON.stringify(config.route))
          throw new Error(
            'Resume route differs from persisted route; explicit route change required',
          );
        const pending = Object.entries(journal.state.effects)
          .filter(([, effect]) => effect.state === 'pending')
          .map(([id]) => id);
        if (pending.length)
          await journal.append(`recovery:${randomUUID()}`, [
            { type: 'recovery', unknownEffects: pending },
          ]);
      }
      const session = new RuntimeSession(journal);
      session.tools = await ToolCoordinator.create(journal);
      return session;
    } catch (error) {
      await journal.close();
      throw error;
    }
  }

  execute(command: RuntimeCommand): Promise<JournalRecord> {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(command.id))
      return Promise.reject(new Error('Invalid command identity'));
    const hash = createHash('sha256').update(JSON.stringify(command.action)).digest('hex');
    const previous = this.inFlight.get(command.id);
    if (previous)
      return previous.hash === hash
        ? previous.work
        : Promise.reject(new Error('Command identity reused for different input'));
    const work = this.dispatch(command).finally(() => this.inFlight.delete(command.id));
    this.inFlight.set(command.id, { hash, work });
    return work;
  }
  private dispatch(command: RuntimeCommand): Promise<JournalRecord> {
    if (command.action.type === 'stopBackground' && this.tools)
      return this.tools.execute({
        id: command.id,
        action: { type: 'tool', name: 'stop_process', args: { processId: command.action.taskId } },
      });
    if (command.action.type === 'interrupt' || command.action.type === 'close')
      this.tools?.cancel();
    if (command.action.type === 'tool') {
      if (this.ended) return Promise.reject(new Error('Runtime closed'));
      if (!this.tools) return Promise.reject(new Error('Tool scope is not configured'));
      return this.tools.execute(command);
    }
    const action = command.action;
    const work = this.queue.then(async () => {
      if (this.ended) throw new Error('Runtime closed');
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(command.id)) throw new Error('Invalid command identity');
      if (action.type === 'respond') {
        const interaction = this.journal.state.interactions[action.interactionId];
        if (
          interaction?.kind === 'question' &&
          interaction.questions.some((question) => question.secret)
        )
          throw new Error('Secret answers require the protected credential/input transport');
      }
      const id = `cmd:${command.id}`;
      const hash = createHash('sha256').update(JSON.stringify(command.action)).digest('hex');
      const previous = this.journal.find(id);
      if (previous) {
        if (previous.requestHash !== hash)
          throw new Error('Command identity reused for different input');
        return previous;
      }
      let facts: import('./model.ts').RuntimeFact[];
      let result: import('./model.ts').CommandResult;
      try {
        if (action.type === 'interrupt' || action.type === 'close') await this.tools?.close();
        if (action.type === 'setRoute') validateRoute(action.route);
        const decision = commandFacts(this.journal.state, action);
        facts = decision.facts;
        result = decision.error ? { error: decision.error } : {};
      } catch (error) {
        // Never persist rejected secret input or an unredacted arbitrary error payload.
        facts = [];
        result = { error: error instanceof Error ? error.message : 'Runtime command rejected' };
      }
      const record = await this.journal.append(id, facts, result, hash);
      if (!result.error && action.type === 'respond')
        this.tools?.answered(action.interactionId, action.answer);
      if ((action.type === 'send' || action.type === 'steer') && !this.journal.state.stopped)
        this.tools?.resume();
      return record;
    });
    this.queue = work.catch(() => undefined);
    return work;
  }

  dispose(): Promise<void> {
    this.disposing ??= this.disposeOnce();
    return this.disposing;
  }
  private async disposeOnce(): Promise<void> {
    this.ended = true;
    await this.tools?.close();
    await this.queue;
    await this.journal.close();
  }
}
