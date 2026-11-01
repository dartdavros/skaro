import { createHash } from 'node:crypto';
import type { RuntimeSession } from '../session.ts';
import type { CommandResult } from '../model.ts';
import type { NativeCall } from './native-types.ts';
import type { ModelTool } from './chat-types.ts';
import type { ModelToolAdmission } from '@skaro/timeline';
export type { ModelToolAdmission } from '@skaro/timeline';

export async function admittedChatTools(
  catalogue: readonly ModelTool[] | undefined,
  admission?: Pick<ModelToolAdmission, 'selectChatTools'>,
  signal?: AbortSignal,
) {
  if (!admission?.selectChatTools) return catalogue;
  const original = catalogue ?? [];
  const selected = structuredClone(
    await admission.selectChatTools(structuredClone(original), signal),
  );
  signal?.throwIfAborted();
  if (
    !Array.isArray(selected) ||
    new Set(selected.map((tool) => tool.name)).size !== selected.length ||
    selected.some(
      (tool) => !original.some((entry) => JSON.stringify(entry) === JSON.stringify(tool)),
    )
  )
    throw new Error('Tool selection may only narrow the admitted catalogue');
  return selected;
}
export async function executeModelTool(input: {
  stepId: string;
  call: NativeCall;
  allowed: ReadonlySet<string>;
  session: RuntimeSession;
  signal: AbortSignal;
  admission?: ModelToolAdmission;
}): Promise<CommandResult> {
  input.signal.throwIfAborted();
  const call = input.call;
  if (!input.allowed.has(call.name))
    return { error: 'Tool is not in the admitted model catalogue' };
  try {
    await input.admission?.requireAllowed(call.name, call.arguments, input.signal);
  } catch {
    input.signal.throwIfAborted();
    const hint = input.admission?.rejectionMessage;
    return {
      error: hint && hint.length <= 512 ? hint : 'Tool request is outside the admitted scope',
    };
  }
  const id = createHash('sha256').update(`${input.stepId}:${call.id}`).digest('hex');
  const record = await input.session.execute({
    id,
    action: { type: 'tool', name: call.name, args: call.arguments },
  });
  input.signal.throwIfAborted();
  if (Buffer.byteLength(JSON.stringify(record.result)) > 16_384)
    return {
      value: {
        kind: 'paged-tool-result',
        reference: { sequence: record.sequence, hash: record.hash },
        notice:
          'Read the complete genuine result with context_history; this reference is not a success verdict.',
      },
    };
  return record.result;
}
