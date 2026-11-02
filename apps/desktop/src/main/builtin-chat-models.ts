import {
  prepareBuiltinSessionModel,
  type BuiltinSessionModelDependencies,
  type BuiltinSessionModelGrant,
  type BuiltinSessionPreparation,
} from './builtin-session-models';
import { requireBuiltinChatSessionPolicy } from './builtin-chat-session-policy';
import { agentRegistration } from '@skaro/agents';

export type BuiltinChatPreparation = Omit<BuiltinSessionPreparation, 'verification'>;
export type BuiltinChatAuthorization = (
  input: BuiltinChatPreparation,
) => Promise<BuiltinSessionModelGrant>;
type Dependencies = BuiltinSessionModelDependencies & { authorize: BuiltinChatAuthorization };

/** Chat authority uses the same model host; task acceptance is never attached to a chat. */
export class BuiltinChatModels {
  get adapterVersion() {
    const entry = agentRegistration('skaro');
    if (!('adapterVersion' in entry)) throw new Error('Builtin runtime is unavailable');
    return entry.adapterVersion;
  }
  private readonly deps: Dependencies;
  constructor(deps: Dependencies) {
    this.deps = deps;
  }
  async prepare(input: BuiltinChatPreparation) {
    input.signal.throwIfAborted();
    const grant = await this.deps.authorize(input);
    return prepareBuiltinSessionModel(this.deps, input, grant, (config) =>
      requireBuiltinChatSessionPolicy(input, config),
    );
  }
}
