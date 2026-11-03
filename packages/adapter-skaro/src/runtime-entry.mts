import { fileURLToPath } from 'node:url';

export const sourceRuntimeEntry = fileURLToPath(
  new URL('../../agent-runtime/src/worker.ts', import.meta.url),
);
