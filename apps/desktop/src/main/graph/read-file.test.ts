import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { expect, it } from 'vitest';
import { readGraphFile } from './read-file';

const document = fileURLToPath(new URL('../../../../../docs/architecture.md', import.meta.url));
const reader = new URL('./read-file.ts', import.meta.url).href;

it('preserves real document bytes and UTF-8 text on main and in the graph worker', async () => {
  const bytes = await readFile(document);
  expect(await readGraphFile(document)).toEqual(bytes);
  expect(await readGraphFile(document, 'utf8')).toBe(bytes.toString('utf8'));
  const worker = new Worker(
    `const {parentPort,workerData}=require('node:worker_threads');
     import(workerData.reader).then(async ({readGraphFile}) => {
       parentPort.postMessage({bytes: await readGraphFile(workerData.document),
         text: await readGraphFile(workerData.document, 'utf8')});
     });`,
    { eval: true, workerData: { reader, document } },
  );
  try {
    const [result] = await once(worker, 'message');
    expect(Buffer.from(result.bytes)).toEqual(bytes);
    expect(result.text).toBe(bytes.toString('utf8'));
  } finally {
    await worker.terminate();
  }
});

it.skipIf(process.platform !== 'win32')(
  'releases Windows file handles when graph reads are forcibly terminated',
  async () => {
    const handles = () =>
      Number(
        execFileSync(
          'powershell.exe',
          ['-NoProfile', '-Command', `(Get-Process -Id ${process.pid}).HandleCount`],
          { encoding: 'utf8', windowsHide: true },
        ).trim(),
      );
    const before = handles();
    for (let i = 0; i < 20; i++) {
      const worker = new Worker(
        `const {parentPort,workerData}=require('node:worker_threads');
         import(workerData.reader).then(async ({readGraphFile}) => {
           parentPort.postMessage('reading');
           for (;;) await Promise.all(Array.from({length:64},
             () => readGraphFile(workerData.document, 'utf8')));
         });`,
        { eval: true, workerData: { reader, document } },
      );
      try {
        await once(worker, 'message');
      } finally {
        await worker.terminate();
      }
    }
    // Allow runner bookkeeping; leaked read batches accumulate hundreds of handles.
    expect(handles() - before).toBeLessThan(64);
  },
  30_000,
);
