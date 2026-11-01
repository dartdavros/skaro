import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'vite';
import { expect, it } from 'vitest';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

const require = createRequire(import.meta.url);
const electron = require('electron') as string;

function run(entry: string, directory: string, operation?: Record<string, unknown>) {
  return new Promise<{ code: number | null; messages: Record<string, unknown>[] }>((done, fail) => {
    const child = spawn(electron, [entry, directory], {
      env: cleanCommandEnvironment(),
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'json',
    });
    const messages: Record<string, unknown>[] = [];
    const timeout = setTimeout(() => {
      child.kill();
      fail(new Error('Real credential host timed out'));
    }, 25_000);
    child.on('error', fail);
    child.on('message', (message: Record<string, unknown>) => {
      messages.push(message);
      if (message.type === 'ready' && operation) child.send(operation);
    });
    child.stderr?.resume();
    child.on('exit', (code) => {
      clearTimeout(timeout);
      done({ code, messages });
    });
  });
}

it.skipIf(process.platform !== 'win32')(
  'protects, rotates and revokes real DPAPI storage with bound cancellable leases',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skaro-credentials-'));
    try {
      await build({
        configFile: false,
        logLevel: 'silent',
        build: {
          ssr: resolve('apps/desktop/src/main/credentials/vault.verification.ts'),
          outDir: join(directory, 'build'),
          emptyOutDir: false,
          minify: false,
          rollupOptions: {
            external: ['electron'],
            output: { entryFileNames: 'verify.cjs', format: 'cjs' },
          },
        },
      });
      const result = await run(join(directory, 'build/verify.cjs'), directory);
      expect(result.messages).toEqual([
        {
          type: 'verified',
          checks: [
            'dpapi',
            'ciphertext',
            'exclusive-owner',
            'cas',
            'bound-port',
            'zero-borrow',
            'error-redaction',
            'cancel',
            'rotation',
            'reopen',
            'revoke',
            'settings-transaction',
          ],
        },
      ]);
      expect(result.code).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
  45_000,
);

it.skipIf(process.platform !== 'win32')(
  'imports and revokes over private IPC using the compiled credential host, without any API request',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'skaro-credential-import-'));
    const storageText = Buffer.from('Skaro-IPC-storage-roundtrip-noncredential');
    try {
      const entry = resolve('apps/desktop/out/main/agent-credential-worker.js');
      const binding = {
        connectionId: 'storage-check',
        connectionRevision: 1,
        endpoint: 'https://api.openai.com/v1',
      };
      const imported = await run(entry, directory, {
        operation: 'replace',
        binding,
        expected: null,
        secretBase64: storageText.toString('base64'),
      });
      expect(imported.code).toBe(0);
      expect(imported.messages[0]).toEqual({
        type: 'ready',
        protection: { state: 'available', backend: 'dpapi' },
      });
      const expected = imported.messages.find((message) => message.type === 'result')?.reference;
      expect(expected).toMatchObject({ revision: 1 });
      const file = await readFile(join(directory, 'credentials/model-credentials.sqlite'));
      expect(file.includes(storageText)).toBe(false);
      expect(file.includes(storageText.toString('base64'))).toBe(false);
      const conflict = await run(entry, directory, {
        operation: 'replace',
        binding,
        expected: null,
        secretBase64: storageText.toString('base64'),
      });
      expect(conflict.code).toBe(1);
      expect(JSON.stringify(conflict.messages)).not.toContain(storageText.toString());
      const revoked = await run(entry, directory, { operation: 'revoke', binding, expected });
      expect(revoked.code).toBe(0);
      expect(revoked.messages.at(-1)).toEqual({ type: 'result', revoked: true });
    } finally {
      storageText.fill(0);
      await rm(directory, { recursive: true, force: true });
    }
  },
  45_000,
);
