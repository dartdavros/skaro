import type { AgentAdapter, SessionOptions } from '@skaro/timeline';
import { startNativeSession } from './client';
import type { NativeConfig } from './protocol';
import { untilCancelled } from '../task-session-cancellation';

/** Account, login and metadata stay on the original adapter, including shared auth invalidation. */
export function nativeAdapter(
  adapter: AgentAdapter,
  config: () => Promise<NativeConfig>,
): AgentAdapter {
  return new Proxy(adapter, {
    get: (target, key: keyof AgentAdapter) => {
      if (key === 'start')
        return async (options: SessionOptions) => {
          const resolved = options.signal
            ? await untilCancelled(config(), options.signal)
            : await config();
          return startNativeSession(resolved, options);
        };
      const value = target[key];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
