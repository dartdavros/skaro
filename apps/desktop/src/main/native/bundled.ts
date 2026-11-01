import { app } from 'electron';
import { isAbsolute, join } from 'node:path';
import type { BuiltinSessionStart, SessionOptions } from '@skaro/timeline';
import { startNativeSession } from './client';
import { extensionBinding, modelBinding } from '@skaro/agent-runtime';
import type { NativeSessionHost } from './host-binding';

/** Internal lifecycle entry; product task/chat selection is deferred to BA-7. */
export function startBuiltinNativeSession(
  config: BuiltinSessionStart,
  attachmentsDir: string,
  options: SessionOptions,
  host: NativeSessionHost = {},
  entries = join(app.getAppPath(), 'out', 'main'),
) {
  const { verification, extensions, model } = host;
  if (!options.processStarted)
    throw new Error('Builtin native sessions require a durable process ownership callback');
  if (model && config.model && JSON.stringify(config.model) !== JSON.stringify(model.policy))
    throw new Error('Builtin model requires its exact persisted policy');
  if (!isAbsolute(entries)) throw new Error('Builtin entries require an absolute build directory');
  if (
    extensions &&
    config.extensionsScope &&
    JSON.stringify(config.extensionsScope) !== JSON.stringify(extensions.scope)
  )
    throw new Error('Builtin extensions require their exact host scope');
  if (
    verification &&
    (!config.tools ||
      (config.tools.verificationScope &&
        JSON.stringify(config.tools.verificationScope) !== JSON.stringify(verification.scope)))
  )
    throw new Error('Builtin verification requires its exact host tool scope');
  return startNativeSession(
    {
      agent: 'skaro',
      bundled: {
        ...config,
        ...(model ? { model: structuredClone(model.policy) } : {}),
        ...(extensions ? { extensionsScope: structuredClone(extensions.scope) } : {}),
        ...(config.tools
          ? {
              tools: {
                ...config.tools,
                commandEntry: join(entries, 'agent-command-worker.js'),
                ...(verification ? { verificationScope: structuredClone(verification.scope) } : {}),
              },
            }
          : {}),
      },
      attachmentsDir,
      entry: join(entries, 'agent-runtime-worker.js'),
      verification: verification && {
        scope: structuredClone(verification.scope),
        admission: structuredClone(verification.admission),
      },
      extensions: extensions && extensionBinding(extensions),
      model: model && modelBinding(model),
    },
    options,
    host,
    join(entries, 'native-worker.js'),
  );
}
