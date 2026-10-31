import { app } from 'electron';
import { join } from 'node:path';
import type { BuiltinSessionStart, SessionOptions } from '@skaro/timeline';
import { startNativeSession } from './client';

/** Internal lifecycle entry; product task/chat selection is deferred to BA-7. */
export function startBuiltinNativeSession(
  config: BuiltinSessionStart,
  attachmentsDir: string,
  options: SessionOptions,
) {
  return startNativeSession(
    {
      agent: 'skaro',
      bundled: {
        ...config,
        ...(config.tools
          ? {
              tools: {
                ...config.tools,
                commandEntry: join(app.getAppPath(), 'out', 'main', 'agent-command-worker.js'),
              },
            }
          : {}),
      },
      attachmentsDir,
      entry: join(app.getAppPath(), 'out', 'main', 'agent-runtime-worker.js'),
    },
    options,
  );
}
