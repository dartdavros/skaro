import { createHash } from 'node:crypto';
import type { RuntimeSession } from '../session.ts';
import type { CommandResult } from '../model.ts';
import type { NativeCall } from './native-types.ts';
import type { ModelTool } from './chat-types.ts';

export interface ModelToolAdmission {
  revision: string;
  requireAllowed(name: string, args: unknown): void;
  projectResult(result: CommandResult): unknown;
  /** Chat-only narrowing of the reviewed catalogue at a genuine tool-result boundary. */
  selectChatTools?(catalogue: readonly ModelTool[]): readonly ModelTool[];
  /** A configured chat protocol may require its current selected tool before finishing. */
  chatToolsRequired?: boolean;
  /** Trusted static policy hint, never text taken from a caught error or repository. */
  rejectionMessage?: string;
}

export function admittedChatTools(
  catalogue: readonly ModelTool[] | undefined,
  admission?: Pick<ModelToolAdmission, 'selectChatTools'>,
) {
  if (!admission?.selectChatTools) return catalogue;
  const original = catalogue ?? [];
  const selected = structuredClone(admission.selectChatTools(structuredClone(original)));
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
    input.admission?.requireAllowed(call.name, call.arguments);
  } catch {
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
