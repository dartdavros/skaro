import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  RouteSnapshot,
  SkaroScope,
  RouteCapabilityAssessment,
  ChatResponse,
} from '@skaro/timeline';
import type { JournalRecord } from '../model.ts';
import { reportModelUsage } from './usage-report.ts';

/** Observed Chat tools only. The trusted host chooses the journal; this never grants execution. */
export function chatToolEvidence(
  records: readonly JournalRecord[],
  input: {
    sessionId: string;
    inputRevision: string;
    commandId: string;
    route: RouteSnapshot;
    scope: SkaroScope;
    requiredTools: readonly string[];
  },
) {
  const byId = new Map(records.map((record) => [record.id, record]));
  if (byId.size !== records.length) throw new Error('Ambiguous primary record identity');
  const config = byId.get('created')?.facts.find((fact) => fact.type === 'created');
  if (
    config?.type !== 'created' ||
    config.config.sessionId !== input.sessionId ||
    !isDeepStrictEqual(config.config.route, input.route) ||
    !isDeepStrictEqual(config.config.model?.scope, input.scope) ||
    config.config.model?.protocol !== 'chat' ||
    config.config.model.input?.revision !== input.inputRevision
  )
    throw new Error('Tool evidence differs from the admitted route/input/scope');
  if (
    !input.requiredTools.length ||
    input.requiredTools.length > 128 ||
    new Set(input.requiredTools).size !== input.requiredTools.length
  )
    throw new Error('Tool evidence requires exact unambiguous operation names');
  const ack = byId.get(`cmd:${input.commandId}`);
  const owner = ack?.result.value as { kind?: string; modelTurnId?: string } | undefined;
  const user = ack?.facts.find((fact) => fact.type === 'input');
  const turnId = owner?.modelTurnId;
  if (ack?.result.error || owner?.kind !== 'owner-input' || !turnId || user?.type !== 'input')
    throw new Error('No acknowledged owner turn for tool evidence');
  const terminal = byId.get(`cmd:${turnId}`);
  if (
    !terminal ||
    terminal.result.error ||
    !terminal.facts.some(
      (fact) =>
        fact.type === 'timeline' &&
        fact.event.t === 'turn.completed' &&
        fact.event.turnId === user.turnId &&
        fact.event.outcome === 'done',
    )
  )
    throw new Error('Tool evidence requires a completed successful model turn');
  const reference = (record: JournalRecord) => ({ sequence: record.sequence, hash: record.hash });
  const observed = [];
  const receipts = reportModelUsage(records).receipts.filter(
    (entry) => entry.effectId.startsWith(`model-${turnId}-`) && entry.receipt !== null,
  );
  if (!receipts.length) throw new Error('Tool evidence requires actual provider receipts');
  for (const entry of receipts) {
    if (!isDeepStrictEqual(entry.route, input.route))
      throw new Error('Tool receipt crossed routes');
    const record = records[entry.receipt!.sequence - 1]!;
    const response = record.result.value as ChatResponse;
    for (const call of response.message.tool_calls ?? []) {
      const id = createHash('sha256').update(`${entry.effectId}:${call.id}`).digest('hex');
      const request = byId.get(`tool-request:${id}`);
      const result = byId.get(`cmd:${id}`);
      if (!request || !result || result.result.error) continue;
      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        continue;
      }
      const hash = createHash('sha256')
        .update(JSON.stringify({ type: 'tool', name: call.function.name, args }))
        .digest('hex');
      if (
        !request.facts.some(
          (fact) =>
            fact.type === 'tool-request' &&
            fact.id === id &&
            fact.name === call.function.name &&
            fact.hash === hash,
        ) ||
        result.requestHash !== hash ||
        !result.facts.some((fact) => fact.type === 'effect-result' && fact.id === id) ||
        !(
          record.sequence < request.sequence &&
          request.sequence < result.sequence &&
          result.sequence < terminal.sequence
        )
      )
        throw new Error('Tool evidence does not match actual request/execution order');
      observed.push({
        name: call.function.name,
        callId: call.id,
        modelReceipt: reference(record),
        request: reference(request),
        result: reference(result),
      });
    }
  }
  for (const name of input.requiredTools)
    if (!observed.some((entry) => entry.name === name))
      throw new Error(`No successful observed tool: ${name}`);
  const assessment: RouteCapabilityAssessment = {
    route: structuredClone(input.route),
    capabilities: {
      tools: 'supported',
      images: 'unknown',
      reasoning: 'unknown',
      parallelTools: 'unknown',
      cache: 'unknown',
      continuation: 'unknown',
      compaction: 'unknown',
      contextTokens: null,
      outputTokens: null,
      evidence: 'verified',
    },
  };
  return {
    assessment,
    source: {
      sessionId: input.sessionId,
      inputRevision: input.inputRevision,
      commandId: input.commandId,
      turnId,
      terminal: reference(terminal),
      head: reference(records.at(-1)!),
    },
    observed,
  };
}
