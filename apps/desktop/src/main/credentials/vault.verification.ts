import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { app } from 'electron';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import type { CredentialReference, ProcessAdmission } from '@skaro/timeline';
import { ModelCredentialVault } from './vault';

// Executed by the real Electron main process. This is storage text, never API authentication.
app.setName('SkaroCredentialVerification');
app.setPath('userData', process.argv[2]!);
void app.whenReady().then(async () => {
  let vault: ModelCredentialVault | undefined;
  const directory = join(app.getPath('userData'), 'credentials');
  const text = 'Skaro-OS-storage-roundtrip-noncredential';
  const input = Buffer.from(text);
  let stage = 'open';
  try {
    vault = new ModelCredentialVault(directory);
    assert.deepEqual(await vault.availability(), { state: 'available', backend: 'dpapi' });
    assert.throws(() => new ModelCredentialVault(directory), /already owned/);
    const binding = {
      connectionId: 'storage-check',
      connectionRevision: 1,
      endpoint: 'https://api.openai.com/v1',
    };
    const reference = await vault.replace({ binding, expected: null, secret: input });
    assert.equal(input.toString(), text); // Caller keeps ownership of its input.
    assert(!readFileSync(join(directory, 'model-credentials.sqlite')).includes(input));
    assert(
      !readFileSync(join(directory, 'model-credentials.sqlite')).includes(input.toString('base64')),
    );
    await assert.rejects(
      vault.replace({ binding, expected: null, secret: input }),
      /revision conflict/,
    );

    const birth = await processBirth(process.pid);
    assert(birth);
    const admission: ProcessAdmission = {
      id: `${process.pid}:${birth}`,
      sessionId: 'storage-check',
      generation: 1,
    };
    // Genuine OS identity verification, without a fake host/admission service.
    const admissions = {
      async requireActive(current: ProcessAdmission, signal: AbortSignal) {
        signal.throwIfAborted();
        assert.deepEqual(current, admission);
        assert.equal(await processBirth(process.pid), birth);
        signal.throwIfAborted();
      },
    };
    const request = { binding, reference, admission, signal: new AbortController().signal };
    stage = 'bound-port';
    const admissionSignal = new AbortController().signal;
    const port = vault.port(request, admissions, admissionSignal);
    let borrowed: Uint8Array | undefined;
    const length = await port.withCredential(request, async (secret) => {
      borrowed = secret;
      assert.equal(Buffer.from(secret).toString(), text);
      return secret.length;
    });
    assert.equal(length, input.length);
    assert(borrowed?.every((byte) => byte === 0));
    for (const changed of [
      { ...request, binding: { ...binding, endpoint: 'https://api.anthropic.com/v1' } },
      { ...request, reference: { ...reference, revision: reference.revision + 1 } },
      { ...request, admission: { ...admission, generation: 2 } },
    ])
      await assert.rejects(
        port.withCredential(changed, async () => {
          throw new Error('Must not consume');
        }),
        /scope mismatch/,
      );
    await assert.rejects(
      port.withCredential(request, async () => {
        throw new Error(text);
      }),
      (error: Error) => !error.message.includes(text),
    );
    await assert.rejects(
      port.withCredential({ ...request, signal: AbortSignal.abort() }, async () => 0),
    );

    let entered!: () => void;
    stage = 'rotation';
    const active = new Promise<void>((resolve) => (entered = resolve));
    const consuming = port.withCredential(request, async (secret, signal) => {
      borrowed = secret;
      entered();
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
      signal.throwIfAborted();
    });
    const cancelled = assert.rejects(consuming, /revoked or cancelled/);
    await active;
    const next = await vault.replace({ binding, expected: reference, secret: input });
    await cancelled;
    assert(borrowed?.every((byte) => byte === 0));
    assert.equal(next.id, reference.id);
    assert.equal(next.revision, reference.revision + 1);
    await assert.rejects(
      port.withCredential(request, async () => 0),
      /revision conflict/,
    );
    await vault.close();
    vault = new ModelCredentialVault(directory);
    const resumed = { ...request, reference: next };
    stage = 'reopen';
    await vault
      .port(resumed, admissions, admissionSignal)
      .withCredential(resumed, async (secret) => {
        assert.equal(Buffer.from(secret).toString(), text);
      });
    await assert.rejects(
      vault.revoke({ ...binding, connectionRevision: 2 }, next),
      /binding or revision conflict/,
    );
    await vault.revoke(binding, next);
    await assert.rejects(
      vault.port(resumed, admissions, admissionSignal).withCredential(resumed, async () => 0),
      /revision conflict/,
    );
    const fresh: CredentialReference = await vault.replace({
      binding,
      expected: null,
      secret: input,
    });
    assert.notEqual(fresh.id, next.id);
    assert.equal(fresh.revision, 1);
    await vault.close();
    vault = undefined;
    process.send?.(
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
        ],
      },
      () => app.exit(0),
    );
  } catch (error) {
    await vault?.close();
    process.send?.(
      {
        type: 'verification-failed',
        stage,
        message:
          error instanceof Error
            ? error.message.replaceAll(text, '[storage text]')
            : 'Unknown verification failure',
      },
      () => app.exit(1),
    );
  } finally {
    input.fill(0);
  }
});
