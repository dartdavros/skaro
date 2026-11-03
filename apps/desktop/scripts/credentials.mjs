import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';
import { readCredential } from './credential-input.mjs';

const require = createRequire(import.meta.url);
let child;
const controller = new AbortController();
try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      connection: { type: 'string' },
      revision: { type: 'string' },
      endpoint: { type: 'string' },
      'expected-id': { type: 'string' },
      'expected-revision': { type: 'string' },
      'data-dir': { type: 'string' },
    },
  });
  const operation = positionals[0];
  const binding = {
    connectionId: values.connection,
    connectionRevision: Number(values.revision),
    endpoint: values.endpoint,
  };
  const expected =
    values['expected-id'] && values['expected-revision']
      ? { id: values['expected-id'], revision: Number(values['expected-revision']) }
      : null;
  if (
    positionals.length !== 1 ||
    !['replace', 'revoke'].includes(operation) ||
    !binding.connectionId ||
    !binding.endpoint ||
    !Number.isSafeInteger(binding.connectionRevision) ||
    binding.connectionRevision < 1 ||
    !!values['expected-id'] !== !!values['expected-revision'] ||
    (expected && (!Number.isSafeInteger(expected.revision) || expected.revision < 1)) ||
    (operation === 'revoke' && !expected)
  )
    throw new Error('Invalid options');
  const endpoint = new URL(binding.endpoint);
  if (
    endpoint.protocol !== 'https:' ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  )
    throw new Error('Invalid endpoint');
  const env = cleanCommandEnvironment();
  // OS account/desktop context for Keychain/Secret Service; model/API variables stay excluded.
  for (const key of [
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'DBUS_SESSION_BUS_ADDRESS',
    'XDG_RUNTIME_DIR',
  ])
    if (process.env[key]) env[key] = process.env[key];
  child = spawn(
    require('electron'),
    [
      fileURLToPath(new URL('../out/main/agent-credential-worker.js', import.meta.url)),
      ...(values['data-dir'] ? [values['data-dir']] : []),
    ],
    {
      env,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      serialization: 'json',
    },
  );
  await new Promise((resolve, reject) => {
    let received = false;
    child.on('error', () => reject(new Error('Credential host could not start')));
    child.on('exit', (code) =>
      code === 0 && received
        ? resolve()
        : reject(new Error('Credential operation did not complete')),
    );
    child.on('message', (message) => {
      void (async () => {
        if (message?.type === 'ready') {
          const secret =
            operation === 'replace' ? await readCredential(controller.signal) : undefined;
          try {
            await new Promise((done, fail) =>
              child.send(
                { operation, binding, expected, secretBase64: secret?.toString('base64') },
                (error) => (error ? fail(error) : done()),
              ),
            );
          } finally {
            secret?.fill(0);
          }
        } else if (message?.type === 'result') {
          received = true;
          console.log(JSON.stringify(message.reference ?? { revoked: true }));
        } else if (message?.type === 'error') reject(new Error('Credential operation rejected'));
      })().catch(reject);
    });
  });
} catch {
  // Never print arbitrary OS/IPC/input errors: they can contain sensitive payloads.
  process.stderr.write(
    'Credential operation failed or cancelled. Check the documented arguments, OS storage and expected revision.\n',
  );
  process.exitCode = 1;
} finally {
  controller.abort();
  if (child?.connected) child.disconnect();
  if (child && child.exitCode === null) child.kill();
}
