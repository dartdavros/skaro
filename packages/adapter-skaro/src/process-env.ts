import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

/** Model credentials and host secrets never enter the runtime process environment. */
export function runtimeEnvironment(): NodeJS.ProcessEnv {
  return { ...cleanCommandEnvironment(), ELECTRON_RUN_AS_NODE: '1' };
}
