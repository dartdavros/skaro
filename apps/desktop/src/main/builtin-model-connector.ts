import { isDeepStrictEqual } from 'node:util';
import {
  OpenRouterConnector,
  OpenAIResponsesConnector,
  AnthropicMessagesConnector,
  DeepSeekChatConnector,
  type ConnectorCredential,
  type ModelFetch,
} from '@skaro/agent-runtime';
import type {
  CredentialPort,
  RouteSnapshot,
  RuntimeModelHost,
  RuntimeModelRequest,
} from '@skaro/timeline';

interface BoundConnector {
  protocol: RuntimeModelRequest['kind'];
  complete: (
    request: RuntimeModelRequest,
    signal: AbortSignal,
    onText?: (text: string) => void,
  ) => ReturnType<RuntimeModelHost['complete']>;
  continue?: RuntimeModelHost['continue'];
}

/** The only connector switch for configured hosts. Neither names nor manufacturers choose it. */
export function builtinModelConnector(
  snapshot: RouteSnapshot,
  credentials: CredentialPort,
  auth: ConnectorCredential,
  load: ModelFetch,
): BoundConnector {
  const route = structuredClone(snapshot);
  if (
    typeof load !== 'function' ||
    route.apiProfile.revision !== 1 ||
    route.connectionId !== auth.binding.connectionId ||
    route.connectionRevision !== auth.binding.connectionRevision ||
    route.endpoint !== auth.binding.endpoint
  )
    throw new Error('Configured connector binding mismatch');
  const requireRoute = (request: RuntimeModelRequest, protocol: RuntimeModelRequest['kind']) => {
    if (request.kind !== protocol || !isDeepStrictEqual(request.value.route, route))
      throw new Error('Configured connector request differs from its route');
  };
  if (
    (route.connector === 'openrouter' && route.apiProfile.id === 'openrouter.chat-completions') ||
    (route.connector === 'deepseek' && route.apiProfile.id === 'deepseek.chat-completions')
  ) {
    const connector =
      route.connector === 'openrouter'
        ? new OpenRouterConnector(credentials, auth, load)
        : new DeepSeekChatConnector(credentials, auth, load);
    return {
      protocol: 'chat',
      async complete(request, signal, onText) {
        requireRoute(request, 'chat');
        if (request.kind !== 'chat') throw new Error('Chat request required');
        return { kind: 'chat', value: await connector.complete(request.value, signal, onText) };
      },
    };
  }
  if (
    (route.connector === 'openai' && route.apiProfile.id === 'openai.responses') ||
    (route.connector === 'anthropic' && route.apiProfile.id === 'anthropic.messages')
  ) {
    const connector =
      route.connector === 'openai'
        ? new OpenAIResponsesConnector(credentials, auth, load)
        : new AnthropicMessagesConnector(credentials, auth, load);
    return {
      protocol: 'native',
      async complete(request, signal, onText) {
        requireRoute(request, 'native');
        if (request.kind !== 'native') throw new Error('Native request required');
        return { kind: 'native', value: await connector.complete(request.value, signal, onText) };
      },
      continue(request, response, results, signal) {
        signal.throwIfAborted();
        requireRoute({ kind: 'native', value: request }, 'native');
        return connector.continue(request, response, results);
      },
    };
  }
  throw new Error('Configured model connector profile is unavailable');
}
