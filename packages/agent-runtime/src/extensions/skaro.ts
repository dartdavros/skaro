import type { ProcessAdmission, ScopedOperationPort } from '@skaro/timeline';
import type { RuntimeExtensionHost } from './registry.ts';
import { contextHash } from '../context/sources.ts';
import { UnknownToolOutcome } from '../tools/effect-error.ts';

/** Bound existing host handlers keep their original scope, acceptance and owner confirmations. */
export async function bindSkaroOperations(
  port: ScopedOperationPort,
  admission: ProcessAdmission,
  allowed: readonly { name: string; readOnly: boolean }[],
  signal: AbortSignal,
): Promise<RuntimeExtensionHost> {
  const catalogue = await port.catalog(admission, signal);
  if (allowed.length > 32 || new Set(allowed.map((tool) => tool.name)).size !== allowed.length)
    throw new Error('Invalid Skaro operation allowlist');
  const bound = structuredClone(admission);
  return {
    close: async () => undefined,
    tools: allowed.map((policy) => {
      const matches = catalogue.filter((entry) => entry.name === policy.name);
      if (matches.length !== 1) throw new Error('Scoped Skaro operation is unavailable');
      const schema = matches[0]!.inputSchema;
      return {
        name: `mcp__skaro__${policy.name}`,
        readOnly: policy.readOnly,
        revision: contextHash({ policy, schema }),
        description: policy.name,
        inputSchema: structuredClone(schema),
        invoke: async (callId, args, callSignal) => {
          try {
            return await port.execute({
              admission: bound,
              callId,
              name: policy.name,
              args,
              signal: AbortSignal.any([signal, callSignal]),
            });
          } catch {
            throw new UnknownToolOutcome(
              'Scoped Skaro operation has no confirmed outcome; automatic replay forbidden',
            );
          }
        },
      };
    }),
  };
}
