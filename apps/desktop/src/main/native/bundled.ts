import { app } from 'electron';
import { isAbsolute, join } from 'node:path';
import type { BuiltinSessionStart, SessionOptions } from '@skaro/timeline';
import { startNativeSession } from './client';
import type { RuntimeVerificationHost } from '@skaro/agent-runtime';

/** Internal lifecycle entry; product task/chat selection is deferred to BA-7. */
export function startBuiltinNativeSession(
  config: BuiltinSessionStart,
  attachmentsDir: string,
  options: SessionOptions,
  verification?: RuntimeVerificationHost,
  entries = join(app.getAppPath(), 'out', 'main'),
) {
  if (!isAbsolute(entries)) throw new Error('Builtin entries require an absolute build directory');
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
    },
    options,
    verification,
    join(entries, 'native-worker.js'),
  );
}
