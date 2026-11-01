import { createHash, randomUUID } from 'node:crypto';
import { requireBuiltinCompatibility, validateModelEndpoint } from '@skaro/timeline';
import type { RouteSnapshot, RuntimeProcessIdentity } from '@skaro/timeline';
import { RuntimeJournal } from './journal.ts';
import { commandFacts } from './commands.ts';
import packageManifest from '../package.json' with { type: 'json' };
import type { JournalRecord, RuntimeCommand, RuntimeStart } from './model.ts';
import { ToolCoordinator } from './tools/coordinator.ts';
import { schemas } from './tools/schemas.ts';
import { RuntimeContext } from './context/service.ts';
import type { RuntimeExtensionHost } from './extensions/registry.ts';
import type { RuntimeVerificationHost } from './verification/host.ts';

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

/** Journal lifecycle and admission shared by tools and separately configured model connectors. */
export class RuntimeSession {
  readonly journal: RuntimeJournal;
  private queue: Promise<unknown> = Promise.resolve();
  private ended = false;
  private disposing?: Promise<void>;
  private readonly inFlight = new Map<string, { hash: string; work: Promise<JournalRecord> }>();
  private tools?: ToolCoordinator;
  private modelAbort = new AbortController();
  private modelWork?: Promise<unknown>;
  context?: RuntimeContext;
  private constructor(journal: RuntimeJournal) {
    this.journal = journal;
  }

  static async open(
    config: RuntimeStart,
    owner: RuntimeProcessIdentity,
    extensions?: RuntimeExtensionHost,
    verification?: RuntimeVerificationHost,
  ): Promise<RuntimeSession> {
    requireBuiltinCompatibility(config.versions);
    if ((config.extensions?.length || extensions) && !config.tools)
      throw new Error('Extensions require a host tool scope');
    if (verification && !config.tools) throw new Error('Verification requires a host tool scope');
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
        if (JSON.stringify(journal.state.config.context) !== JSON.stringify(config.context))
          throw new Error('Resume context scope differs from persisted host configuration');
        if (JSON.stringify(journal.state.config.extensions) !== JSON.stringify(config.extensions))
          throw new Error('Resume extensions differ from persisted host policy');
        if (
          JSON.stringify(journal.state.config.extensionsScope) !==
          JSON.stringify(config.extensionsScope)
        )
          throw new Error('Resume extension scope differs from persisted host policy');
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
      session.tools = await ToolCoordinator.create(journal, extensions, verification);
      session.context = await RuntimeContext.create(journal);
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
  runModel<T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> {
    if (this.ended || this.journal.state.stopped || this.journal.state.closed)
      return Promise.reject(new Error('Model admission is closed'));
    if (this.modelWork) return Promise.reject(new Error('A model turn is already active'));
    if (
      Object.keys(this.journal.state.interactions).length ||
      Object.values(this.journal.state.effects).some((effect) => effect.state === 'pending')
    )
      return Promise.reject(new Error('An effect or interaction prevents model admission'));
    const signal = this.modelAbort.signal;
    const result = Promise.resolve()
      .then(() => work(signal))
      .finally(() => {
        if (this.modelWork === result) this.modelWork = undefined;
      });
    this.modelWork = result;
    return result;
  }
  private dispatch(command: RuntimeCommand): Promise<JournalRecord> {
    if (command.action.type === 'stopBackground' && this.tools)
      return this.tools.execute({
        id: command.id,
        action: { type: 'tool', name: 'stop_process', args: { processId: command.action.taskId } },
      });
    if (command.action.type === 'interrupt' || command.action.type === 'close') {
      this.modelAbort.abort();
      this.tools?.cancel();
    }
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
        if (action.type === 'interrupt' || action.type === 'close') {
          if (action.type === 'close') await this.tools?.close();
          else await this.tools?.interrupt();
          await Promise.allSettled([this.modelWork]);
        } else if (this.modelWork && action.type !== 'respond')
          throw new Error('An active model turn prevents this context change');
        if (action.type === 'setRoute') validateRoute(action.route);
        if ((action.type === 'compact' || action.type === 'refreshContext') && this.context) {
          const value = await this.context.project(
            action.type === 'compact',
            this.modelAbort.signal,
          );
          return await this.journal.append(
            id,
            action.type === 'compact'
              ? [
                  {
                    type: 'continuation',
                    route: this.journal.state.config!.route,
                    value: { schema: 1, kind: 'context-boundary', epoch: value.epoch },
                  },
                ]
              : [],
            { value },
            hash,
          );
        }
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
      if ((action.type === 'send' || action.type === 'steer') && !this.journal.state.stopped) {
        this.tools?.resume();
        if (this.modelAbort.signal.aborted) this.modelAbort = new AbortController();
      }
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
    this.modelAbort.abort();
    await this.tools?.close();
    await Promise.allSettled([this.modelWork]);
    await this.queue;
    await this.journal.close();
  }
}
