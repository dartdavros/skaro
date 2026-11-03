import { app } from 'electron';
import { join, resolve } from 'node:path';
import type { CredentialBinding, CredentialReference } from '@skaro/timeline';
import { ModelCredentialVault } from './vault';

// Privileged developer import, not a renderer IPC handler or a model tool.
app.setName('Skaro');
if (process.argv[2]) app.setPath('userData', resolve(process.argv[2]));
let vault: ModelCredentialVault | undefined;
let started = false;
function reply(value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!process.send) {
      reject(new Error('Private IPC unavailable'));
      return;
    }
    process.send(value, (error: Error | null) => (error ? reject(error) : resolve()));
  });
}
async function stop(code: number): Promise<void> {
  await vault?.close();
  app.exit(code);
}
process.on('disconnect', () => void stop(1));
process.on('message', (message: unknown) => {
  if (started || !vault) return;
  started = true;
  const input = message as {
    operation?: string;
    binding: CredentialBinding;
    expected: CredentialReference | null;
    secretBase64?: string;
  };
  let secret: Buffer | undefined;
  void (async () => {
    try {
      if (input.operation === 'replace' && typeof input.secretBase64 === 'string') {
        secret = Buffer.from(input.secretBase64, 'base64');
        input.secretBase64 = undefined;
        const reference = await vault!.replace({ ...input, secret });
        secret.fill(0);
        await reply({ type: 'result', reference });
      } else if (input.operation === 'revoke' && input.expected) {
        await vault!.revoke(input.binding, input.expected);
        await reply({ type: 'result', revoked: true });
      } else throw new Error('Invalid operation');
      await stop(0);
    } catch {
      secret?.fill(0);
      await reply({
        type: 'error',
        message: 'Credential operation rejected; check binding, revision and storage availability',
      }).catch(() => undefined);
      await stop(1);
    } finally {
      secret?.fill(0);
    }
  })();
});
void app.whenReady().then(async () => {
  try {
    vault = new ModelCredentialVault(join(app.getPath('userData'), 'credentials'));
    await reply({ type: 'ready', protection: await vault.availability() });
  } catch {
    await reply({
      type: 'error',
      message: 'OS credential storage unavailable or already owned by a running host',
    }).catch(() => undefined);
    await stop(1);
  }
});
