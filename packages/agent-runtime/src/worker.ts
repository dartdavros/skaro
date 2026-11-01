import { RuntimeSession } from './session.ts';
import type { ParentMessage, RuntimeMessage } from './model.ts';
import { VerificationClient } from './verification/ipc-client.ts';

let session: RuntimeSession | undefined;
let startup: Promise<void> | undefined;
let verification: VerificationClient | undefined;
const post = (message: RuntimeMessage) => {
  if (process.connected) process.send?.(message);
};
const fatal = (error: unknown) => {
  verification?.close();
  post({ type: 'fatal', error: error instanceof Error ? error.message : 'Runtime failed' });
  process.exitCode = 1;
  void session?.dispose().finally(() => {
    if (process.connected) process.disconnect();
  });
  if (!session && process.connected) process.disconnect();
};
process.on('message', (message: ParentMessage) => {
  if (message.type === 'verification-result') {
    verification?.receive(message);
    return;
  }
  if (message.type === 'start') {
    if (startup) {
      fatal(new Error('Runtime already initialized'));
      return;
    }
    startup = (async () => {
      if (message.verification) verification = new VerificationClient(message.verification, post);
      session = await RuntimeSession.open(
        message.config,
        message.owner,
        undefined,
        verification?.host(),
      );
      post({ type: 'ready', records: session.journal.records });
      session.journal.subscribe((record) => post({ type: 'record', record }));
    })();
    void startup.catch(fatal);
    return;
  }
  void (async () => {
    await startup;
    if (!session) throw new Error('Runtime not admitted');
    const record = await session.execute(message.command);
    post({ type: 'reply', id: message.command.id, result: record.result });
    if (message.command.action.type === 'close' && !record.result.error) {
      await session.dispose();
      if (process.connected) process.disconnect();
    }
  })().catch(fatal);
});
process.on('disconnect', () => {
  verification?.close();
  void (async () => {
    await startup;
    await session?.dispose();
  })().catch(() => {
    process.exitCode = 1;
  });
});
