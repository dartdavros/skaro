import type { BuiltinTaskSessionPreparer } from './builtin-task-session';
import { requireBuiltinTaskSessionPolicy } from './builtin-task-session-policy';
import {
  prepareBuiltinSessionModel,
  type BuiltinSessionModelDependencies,
  type BuiltinSessionModelGrant,
} from './builtin-session-models';

type Preparation = Parameters<BuiltinTaskSessionPreparer['prepare']>[0];
export type BuiltinTaskModelGrant = BuiltinSessionModelGrant;
export type BuiltinTaskAuthorization = (input: Preparation) => Promise<BuiltinTaskModelGrant>;
type Dependencies = BuiltinSessionModelDependencies & { authorize: BuiltinTaskAuthorization };

/** Task-specific admission around the common configured model host. */
export class BuiltinTaskModels implements BuiltinTaskSessionPreparer {
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async prepare(input: Preparation) {
    input.signal.throwIfAborted();
    const grant = await this.deps.authorize(input);
    return prepareBuiltinSessionModel(this.deps, input, grant, (config) =>
      requireBuiltinTaskSessionPolicy(input, config),
    );
  }
}
