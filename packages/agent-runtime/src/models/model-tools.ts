import { createHash } from 'node:crypto';
import type { RuntimeSession } from '../session.ts';
import type { CommandResult } from '../model.ts';
import type { NativeCall } from './native-types.ts';

export interface ModelToolAdmission {
  revision: string;
  requireAllowed(name: string, args: unknown): void;
  projectResult(result: CommandResult): unknown;
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
    return { error: 'Tool request is outside the admitted scope' };
  }
  const id = createHash('sha256').update(`${input.stepId}:${call.id}`).digest('hex');
  const record = await input.session.execute({
    id,
    action: { type: 'tool', name: call.name, args: call.arguments },
  });
  input.signal.throwIfAborted();
  return record.result;
}
