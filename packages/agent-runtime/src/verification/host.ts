import type { RuntimeVerificationHost } from '@skaro/timeline';
export type { RuntimeVerificationHost } from '@skaro/timeline';
import type { RuntimeJournal } from '../journal.ts';
import type { PathScope } from '../tools/path-scope.ts';
import { fingerprint } from './inputs.ts';

export function requireVerificationHost(journal: RuntimeJournal, host?: RuntimeVerificationHost) {
  const config = journal.state.config!;
  host?.signal?.throwIfAborted();
  if (
    !host ||
    host.scope.kind !== 'task' ||
    !host.scope.taskId ||
    !host.scope.runId ||
    !config.tools?.verificationScope ||
    fingerprint(host.scope) !== fingerprint(config.tools.verificationScope) ||
    host.admission.sessionId !== config.sessionId
  )
    throw new Error('Authoritative verification host is unavailable or outside the session scope');
  return host;
}

export async function inspectVerificationHost(
  journal: RuntimeJournal,
  scope: PathScope,
  supplied: RuntimeVerificationHost | undefined,
  signal: AbortSignal,
) {
  const host = requireVerificationHost(journal, supplied);
  const state = await host.acceptance.inspect(host.admission, signal);
  signal.throwIfAborted();
  if (
    !state.binding ||
    state.binding.checkout !== scope.root ||
    fingerprint(state.binding.scope) !== fingerprint(host.scope)
  )
    throw new Error('Acceptance projection differs from the bound verification scope');
  return state;
}
