import { RuntimeSession } from './session.ts';
import type { ParentMessage, RuntimeMessage } from './model.ts';
import { VerificationClient } from './verification/ipc-client.ts';
import { ExtensionClient } from './extensions/ipc-client.ts';
import { requireExtensionBinding } from './extensions/ipc-binding.ts';
import { ModelClient } from './models/ipc-client.ts';
import { requireModelBinding } from './models/host-binding.ts';
import { RuntimeCommandRejected } from './command-error.ts';

let session: RuntimeSession | undefined;
let startup: Promise<void> | undefined;
let verification: VerificationClient | undefined;
let extensions: ExtensionClient | undefined;
let model: ModelClient | undefined;
const post = (message: RuntimeMessage) => {
  if (process.connected) process.send?.(message);
};
const fatal = (error: unknown) => {
  verification?.close();
  extensions?.close();
  model?.close();
  post({ type: 'fatal', error: error instanceof Error ? error.message : 'Runtime failed' });
  process.exitCode = 1;
  void session?.dispose().finally(() => {
    if (process.connected) process.disconnect();
  });
  if (!session && process.connected) process.disconnect();
};
process.on('message', (message: ParentMessage) => {
  if (message.type === 'model-rpc-result' || message.type === 'model-rpc-text') {
    model?.receive(message);
    return;
  }
  if (message.type === 'runtime-rpc-result') {
    extensions?.receive(message);
    return;
  }
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
      requireExtensionBinding(message.config, message.extensions);
      if (message.extensions) extensions = new ExtensionClient(message.extensions, post);
      requireModelBinding(message.config, message.model);
      if (message.model) model = new ModelClient(message.model, post);
      session = await RuntimeSession.open(
        message.config,
        message.owner,
        extensions?.host().extensions,
        verification?.host(),
        model?.host(),
      );
      session.onBackgroundError(fatal);
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
  })().catch((error: unknown) => {
    if (error instanceof RuntimeCommandRejected)
      post({ type: 'reply', id: message.command.id, result: { error: error.message } });
    else fatal(error);
  });
});
process.on('disconnect', () => {
  verification?.close();
  extensions?.close();
  model?.close();
  void (async () => {
    await startup;
    await session?.dispose();
  })().catch(() => {
    process.exitCode = 1;
  });
});
