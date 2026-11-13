import { existsSync } from 'node:fs';
import { join } from 'node:path';

export function nativeWorkerEntry(): string {
  for (const path of [
    join(__dirname, 'native-worker.js'),
    join(__dirname, '../native-worker.js'),
    join(__dirname, '../../../out/main/native-worker.js'),
  ])
    if (existsSync(path)) return path;
  throw new Error('The native worker is not built. Build the desktop application first.');
}
