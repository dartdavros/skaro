import type { RuntimeSessionHost } from '@skaro/timeline';
import {
  extensionBinding,
  requireExtensionBinding,
  modelBinding,
  requireModelBinding,
  requireSameHostScope,
} from '@skaro/agent-runtime';
import type { NativeConfig } from './protocol';

export interface NativeSessionHost extends RuntimeSessionHost {
  /** Revokes the whole admitted session; individual port signals only revoke that port. */
  signal?: AbortSignal;
}

/** Host implementations never serialize. Reject unbound persisted policies before any spawn. */
export function requireNativeSessionHost(config: NativeConfig, host: NativeSessionHost) {
  host.signal?.throwIfAborted();
  const { verification, extensions, model } = host;
  verification?.signal?.throwIfAborted();
  extensions?.signal?.throwIfAborted();
  model?.signal?.throwIfAborted();
  if (!('bundled' in config)) {
    if (verification || extensions || model || host.signal)
      throw new Error('Managed sessions do not accept builtin host ports');
    return;
  }
  if (verification || config.verification || config.bundled.tools?.verificationScope) {
    if (
      !verification ||
      JSON.stringify(config.verification) !==
        JSON.stringify({ scope: verification.scope, admission: verification.admission }) ||
      JSON.stringify(config.bundled.tools?.verificationScope) !==
        JSON.stringify(verification.scope) ||
      config.bundled.sessionId !== verification.admission.sessionId
    )
      throw new Error('Native verification binding differs from its host');
  }
  const binding = extensions && extensionBinding(extensions);
  if (JSON.stringify(config.extensions) !== JSON.stringify(binding))
    throw new Error('Native extension binding differs from its host');
  requireExtensionBinding(config.bundled, binding);
  const modelBound = model && modelBinding(model);
  if (JSON.stringify(config.model) !== JSON.stringify(modelBound))
    throw new Error('Native model binding differs from its host');
  requireModelBinding(config.bundled, modelBound);
  requireSameHostScope(host);
  if (
    verification &&
    extensions &&
    (JSON.stringify(verification.scope) !== JSON.stringify(extensions.scope) ||
      JSON.stringify(verification.admission) !== JSON.stringify(extensions.admission))
  )
    throw new Error('Native host ports require the same bound scope and admission');
}
