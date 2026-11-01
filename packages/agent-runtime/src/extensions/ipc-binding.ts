import type {
  BuiltinSessionStart,
  RuntimeExtensionBinding,
  RuntimeScopedExtensionHost,
} from '@skaro/timeline';
import { fingerprint } from '../verification/inputs.ts';

export function extensionBinding(host: RuntimeScopedExtensionHost): RuntimeExtensionBinding {
  return structuredClone({
    scope: host.scope,
    admission: host.admission,
    tools: host.extensions.tools.map(({ invoke: _invoke, ...tool }) => tool),
  });
}

/** Policies are persisted, but executable handlers always require a fresh privileged host. */
export function requireExtensionBinding(
  config: BuiltinSessionStart,
  binding?: RuntimeExtensionBinding,
) {
  const policy = config.extensions ?? [];
  if (
    (!binding && (policy.length || config.extensionsScope)) ||
    (binding &&
      (binding.admission.sessionId !== config.sessionId ||
        !config.extensionsScope ||
        fingerprint(config.extensionsScope) !== fingerprint(binding.scope) ||
        binding.tools.length > 64 ||
        fingerprint(policy) !==
          fingerprint(
            binding.tools.map(({ name, revision, readOnly }) => ({ name, revision, readOnly })),
          )))
  )
    throw new Error('Native extension binding differs from its persisted host policy');
}
