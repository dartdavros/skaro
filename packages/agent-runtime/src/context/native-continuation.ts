import { isDeepStrictEqual } from 'node:util';
import type { NativeRequest, NativeResponse, NativeToolResult } from '@skaro/timeline';
import { contextNativeRequest, type ContextJournalView } from './request.ts';
import { continueNativeConversation } from '../models/native-continuation.ts';

/** Reuse exact native items only within the same route and scoped context epoch. */
export function continueContextNativeRequest(
  session: ContextJournalView,
  request: NativeRequest,
): NativeRequest {
  const fresh = contextNativeRequest(session, request);
  const stored = session.journal.state.continuation;
  const value = stored?.value as
    | {
        schema?: number;
        protocol?: NativeRequest['route']['apiProfile'];
        context?: NativeRequest['context'];
        system?: string;
        input?: NativeRequest['input'];
        response?: NativeResponse;
        results?: NativeToolResult[];
      }
    | undefined;
  if (
    !stored ||
    value?.schema !== 1 ||
    !value.response ||
    !isDeepStrictEqual(stored.route, request.route) ||
    !isDeepStrictEqual(value.protocol, request.route.apiProfile) ||
    !isDeepStrictEqual(value.context, fresh.context)
  )
    return fresh;
  if (
    !Array.isArray(value.input) ||
    !value.input.length ||
    typeof value.system !== 'string' ||
    Object.keys(session.journal.state.interactions).length ||
    Object.values(session.journal.state.effects).some((effect) => effect.state !== 'completed')
  )
    throw new Error('Unresolved or incompatible native context continuation');
  const previous = continueNativeConversation(
    { ...fresh, input: value.input },
    value.response,
    value.results,
  );
  // Fresh exact owner statements stay in the host system frame. History/source references
  // advance without changing scoped-source revision, so deliver the current data frame too.
  return structuredClone({ ...previous, input: [...previous.input, ...fresh.input] });
}
