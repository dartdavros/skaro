import type {
  BuiltinSessionStart,
  RuntimeModelHost,
  RuntimeModelBinding,
  RuntimeSessionHost,
} from '@skaro/timeline';
import { fingerprint } from '../verification/inputs.ts';
import { readRuntimeJournal } from '../journal-reader.ts';

export function modelBinding(host: RuntimeModelHost): RuntimeModelBinding {
  return structuredClone({
    scope: host.scope,
    admission: host.admission,
    route: host.route,
    journalPath: host.journalPath,
    baseSequence: host.baseSequence,
    baseHash: host.baseHash,
    policy: host.policy,
  });
}
export function requireModelBinding(config: BuiltinSessionStart, model?: RuntimeModelBinding) {
  if (!model && !config.model) return;
  if (
    !model ||
    !config.model ||
    !config.tools ||
    model.journalPath !== config.journalPath ||
    model.admission.sessionId !== config.sessionId ||
    fingerprint(model.route) !== fingerprint(config.route) ||
    fingerprint(model.policy) !== fingerprint(config.model) ||
    fingerprint(model.scope) !== fingerprint(config.model.scope) ||
    !Number.isSafeInteger(model.baseSequence) ||
    model.baseSequence < 0 ||
    (model.baseSequence === 0 ? model.baseHash !== '' : !/^[a-f0-9]{64}$/.test(model.baseHash))
  )
    throw new Error('Model host differs from the persisted runtime binding');
}
export function requireModelHostPolicy(host: RuntimeModelHost) {
  const tools = host.toolAdmission;
  const actual = tools && {
    revision: tools.revision,
    selectChatTools: !!tools.selectChatTools,
    chatToolsRequired: tools.chatToolsRequired,
    rejectionMessage: tools.rejectionMessage,
  };
  if (
    fingerprint(actual ?? null) !== fingerprint(host.policy.tools ?? null) ||
    (host.policy.protocol === 'native' && !host.continue)
  )
    throw new Error('Model host policy differs from its implementation');
}
export async function requireModelBaseline(model?: RuntimeModelBinding) {
  if (!model) return;
  const snapshot = await readRuntimeJournal(model.journalPath, model.admission.sessionId, true);
  if (
    snapshot.records.length !== model.baseSequence ||
    (snapshot.records.at(-1)?.hash ?? '') !== model.baseHash
  )
    throw new Error('Model journal baseline changed before startup');
}
export function requireSameHostScope(host: RuntimeSessionHost) {
  const ports = [host.verification, host.extensions, host.model].filter((port) => !!port);
  if (
    ports.some(
      (port) =>
        fingerprint({ scope: port.scope, admission: port.admission }) !==
        fingerprint({ scope: ports[0]!.scope, admission: ports[0]!.admission }),
    )
  )
    throw new Error('Runtime host ports require the same scope and admission');
}
