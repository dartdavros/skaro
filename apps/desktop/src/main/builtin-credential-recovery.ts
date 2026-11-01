import { isDeepStrictEqual } from 'node:util';
import type { BuiltinModelConfigurationState } from '@skaro/agent-runtime';
type Pending = NonNullable<BuiltinModelConfigurationState['pendingCredential']>;
type Metadata = NonNullable<Pending['previous']>;

/** Pure crash decision from actual vault metadata. Never decrypt, guess or replay an import. */
export function credentialRecoveryDecision(pending: Pending, actual: Metadata | undefined) {
  if (isDeepStrictEqual(actual ?? null, pending.next)) return 'commit';
  if (isDeepStrictEqual(actual ?? null, pending.previous)) return 'cancel';
  throw new Error('Credential configuration outcome requires explicit recovery');
}
