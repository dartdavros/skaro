import { fileURLToPath } from 'node:url';

export const sourceCommandEntry = fileURLToPath(new URL('./command-worker.ts', import.meta.url));
