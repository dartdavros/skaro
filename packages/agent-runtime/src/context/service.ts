import type { BuiltinContextConfig } from '@skaro/timeline';
import type { RuntimeJournal } from '../journal.ts';
import { PathScope } from '../tools/path-scope.ts';
import { sessionFileScope } from '../tools/session-scope.ts';
import { collectContext, contextPage } from './sources.ts';
import { contextCheckpoint, latestContext } from './checkpoint.ts';
import type { ContextCheckpoint } from './model.ts';
import { contextProjectionBlocked } from './effect-boundary.ts';

export class RuntimeContext {
  private readonly journal: RuntimeJournal;
  private readonly config: BuiltinContextConfig;
  private readonly scope: PathScope;
  private constructor(journal: RuntimeJournal, config: BuiltinContextConfig, scope: PathScope) {
    this.journal = journal;
    this.config = structuredClone(config);
    this.scope = scope;
  }
  static async create(journal: RuntimeJournal): Promise<RuntimeContext | undefined> {
    const config = journal.state.config!;
    if (!config.context) return undefined;
    if (!config.tools) throw new Error('Context requires a host file scope');
    const scope = await sessionFileScope(journal);
    return new RuntimeContext(journal, config.context, scope);
  }
  async project(
    compact: boolean,
    signal: AbortSignal,
    freshOwnerInput = false,
  ): Promise<ContextCheckpoint> {
    signal.throwIfAborted();
    const state = this.journal.state;
    if (contextProjectionBlocked(state, freshOwnerInput))
      throw new Error('Open interactions or unresolved effects prevent context projection');
    const snapshot = await collectContext(this.scope, this.config, signal);
    signal.throwIfAborted();
    return contextCheckpoint(this.journal, snapshot, compact);
  }
  async requireCurrent(
    revision: string,
    epoch: number,
    signal: AbortSignal,
  ): Promise<ContextCheckpoint> {
    const current = latestContext(this.journal);
    if (!current || current.snapshot.revision !== revision || current.epoch !== epoch)
      throw new Error('Context selection is stale; prepare a fresh request');
    const live = await collectContext(this.scope, this.config, signal);
    if (live.revision !== revision) throw new Error('Context sources changed; refresh required');
    return current;
  }
  async page(id: string, cursor: number, limit: number, signal: AbortSignal) {
    const current = latestContext(this.journal);
    if (!current) throw new Error('Context must be refreshed before reading a page');
    return contextPage(this.scope, current.snapshot, id, cursor, limit, signal);
  }
}
