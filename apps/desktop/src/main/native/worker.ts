import { parentPort, workerData } from 'node:worker_threads';
import { createAgentAdapter, startBundledSession } from '@skaro/agents';
import { AttachmentStore } from '@skaro/core';
import {
  isRunLogMeta,
  runEvent,
  segmentTurns,
  type AgentSession,
  type RawLine,
  type SessionOptions,
} from '@skaro/timeline';
import { processBirthSync } from '../process-identity';
import { SecretValues } from '../secret-values';
import { presentationEvent } from '../timeline-presentation';
import type { NativeConfig, NativeOptions, Reply, Request } from './protocol';
import {
  VerificationClient,
  ExtensionClient,
  ModelClient,
  requireExtensionBinding,
  requireModelBinding,
} from '@skaro/agent-runtime';
import type {
  VerificationInspectReply,
  RuntimeRpcReply,
  RuntimeModelRpcReply,
} from '@skaro/timeline';

const config = workerData as NativeConfig;
const port = parentPort!;
const verification =
  'bundled' in config && config.verification
    ? new VerificationClient(config.verification, (request) => port.postMessage(request))
    : undefined;
const extensions =
  'bundled' in config && config.extensions
    ? new ExtensionClient(config.extensions, (request) => port.postMessage(request))
    : undefined;
const model =
  'bundled' in config && config.model
    ? new ModelClient(config.model, (request) => port.postMessage(request))
    : undefined;
const secrets = new SecretValues();
let session: AgentSession | undefined;
let startup: Promise<void> | undefined;
const startupAbort = new AbortController();
function post(reply: Reply): void {
  port.postMessage(reply);
}

function optionsOf(options: NativeOptions): SessionOptions {
  return {
    ...options,
    context: new AttachmentStore(config.attachmentsDir).context(),
    processStarted: (pid) => {
      const birth = processBirthSync(pid);
      if (!birth) throw new Error('The agent process exited before ownership was recorded');
      const gate = new SharedArrayBuffer(4);
      const state = new Int32Array(gate);
      post({ type: 'spawn', process: { pid, birth, platform: process.platform }, gate });
      // Only this worker waits. Native work cannot begin before the main process commits ownership.
      Atomics.wait(state, 0, 0);
      if (Atomics.load(state, 0) !== 1) throw new Error('Native process admission was rejected');
    },
    raw: (source) => {
      const scope = options.rawScope;
      let line: RawLine = source;
      if (scope) {
        let meta = line.line;
        if (
          scope.segment !== undefined &&
          line.dir === 'meta' &&
          isRunLogMeta(meta) &&
          meta.skaro === 'event'
        ) {
          const event = segmentTurns(scope.segment, meta.event);
          meta = { ...meta, event: scope.runId ? runEvent(event, scope.runId) : event };
        }
        line = { ...line, line: meta, ts: Date.now() - scope.startedAt };
      }
      const bytes = new TextEncoder().encode(JSON.stringify(secrets.redact(line)) + '\n').buffer;
      // Transfer ownership: even a huge native result never becomes a main-thread JSON string.
      port.postMessage({ type: 'raw', bytes } satisfies Reply, [bytes]);
    },
  };
}

async function start(options: NativeOptions): Promise<void> {
  const resolved = optionsOf(options);
  resolved.signal = startupAbort.signal;
  if ('bundled' in config) {
    requireExtensionBinding(config.bundled, config.extensions);
    requireModelBinding(config.bundled, config.model);
    session = await startBundledSession(config.agent, {
      config: config.bundled,
      entry: config.entry,
      processStarted: resolved.processStarted,
      raw: resolved.raw,
      journalReplay: resolved.journalReplay,
      signal: resolved.signal,
      verification: verification?.host(),
      extensions: extensions?.host(),
      model: model?.host(),
    });
  } else {
    const adapter = await createAgentAdapter(config.agent, {
      installed: async () => ({ binary: config.binary, pathDirs: config.pathDirs }),
      authRevision: config.authRevision,
      openUrl: () => {
        throw new Error('Sign-in belongs to the main process');
      },
    });
    session = await adapter.start(resolved);
  }
  const started = session;
  void (async () => {
    for await (const event of started.events)
      post({ type: 'event', event: presentationEvent(secrets.redact(event)) });
  })().then(
    () => post({ type: 'ended' }),
    (error: unknown) => post({ type: 'ended', error: String(error) }),
  );
}

port.on(
  'message',
  (request: Request | VerificationInspectReply | RuntimeRpcReply | RuntimeModelRpcReply) => {
    if (
      'type' in request &&
      (request.type === 'model-rpc-result' || request.type === 'model-rpc-text')
    ) {
      model?.receive(request);
      return;
    }
    if ('type' in request && request.type === 'runtime-rpc-result') {
      extensions?.receive(request);
      return;
    }
    if ('type' in request) {
      verification?.receive(request);
      return;
    }
    secrets.remember(request.secrets);
    void (async () => {
      if (request.method === 'start') {
        if (startup) throw new Error('The native session is already starting');
        startup = start(request.args[0] as NativeOptions);
        return startup;
      }
      if (!session && (request.method === 'close' || request.method === 'interrupt')) {
        startupAbort.abort();
        await startup?.catch(() => undefined);
        if (!session) return;
      }
      if (!session) throw new Error('The native session is not ready');
      if (
        request.method === 'invokeTool' ||
        request.method === 'runModelTurn' ||
        request.method === 'deliverInput'
      ) {
        const method = session[request.method as keyof typeof session];
        if (typeof method !== 'function')
          throw new Error('This session does not expose builtin tools');
        return (method as (...args: unknown[]) => Promise<unknown>).apply(session, request.args);
      }
      const method = session[request.method] as (...args: unknown[]) => Promise<void>;
      try {
        return await method.apply(session, request.args);
      } finally {
        if (request.method === 'close') {
          verification?.close();
          extensions?.close();
          model?.close();
        }
      }
    })().then(
      (value) => post({ type: 'reply', id: request.id, value }),
      (error: unknown) =>
        post({
          type: 'reply',
          id: request.id,
          error: error instanceof Error ? error.message : String(error),
        }),
    );
  },
);
