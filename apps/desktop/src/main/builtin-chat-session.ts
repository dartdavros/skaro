import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { ChatSettings } from '../shared/ipc';
import type { ChatEngine } from './chat-engine';
import type { LiveChat } from './chat-model';
import { builtinChatAdmission } from './builtin-chat-admission';
import { requireBuiltinChatSessionPolicy } from './builtin-chat-session-policy';
import { chatSessionOptions } from './chat-session-options';
import { settingsKey } from './chat-settings-helpers';
import { TaskRunProcesses } from './task-run-processes';
import { startBuiltinNativeSession } from './native/bundled';
import { revokeNativeSession, confirmNativeSessionExit } from './native/session-lease';

/** Attach an existing genuine builtin chat to its normal conversation and process lifecycle. */
export async function startBuiltinChatSession(ctx: ChatEngine, live: LiveChat) {
  const models = ctx.deps.builtinChatSessions;
  if (!models) throw new Error('Builtin chat model/payload/budget admission is not configured');
  const signal = live.operation.signal;
  const { chat } = live;
  const resume = chat.nativeSessionId;
  const sessionId = resume ?? randomUUID();
  const directory = join(ctx.deps.dataDir, 'builtin', 'chats', chat.id);
  const { lease, scope, requireCurrent } = await builtinChatAdmission(ctx, live, sessionId, signal);
  const processes = new TaskRunProcesses(ctx.deps.db);
  let prepared: Awaited<ReturnType<typeof models.prepare>> | undefined;
  let session: Awaited<ReturnType<typeof startBuiltinNativeSession>> | undefined;
  try {
    const combined = AbortSignal.any([signal, lease.signal]);
    await processes.stop(`chat.${chat.id}`);
    const context = ctx.project(live.projectId);
    const artifacts = await context.summary();
    const settings =
      ctx.deps.db.getSetting<Omit<ChatSettings, 'agent'> | null>(settingsKey(chat.id), null) ?? {};
    const options = await chatSessionOptions(ctx, live, artifacts, settings, (pid, identity) =>
      processes.started(`chat.${chat.id}`, pid, false, identity),
    );
    requireCurrent(combined);
    const expected = {
      scope,
      sessionId,
      journalPath: join(directory, 'journal.jsonl'),
      artifactDir: join(directory, 'artifacts'),
      options,
    };
    prepared = await models.prepare({
      ...expected,
      scope: structuredClone(scope),
      options: { ...options, ...(options.readDirs ? { readDirs: [...options.readDirs] } : {}) },
      admissions: lease,
      signal: combined,
    });
    requireBuiltinChatSessionPolicy(expected, prepared.config);
    requireCurrent(combined);
    live.builtinClose = () => prepared!.close();
    ctx.deps.db.updateChat(chat.id, { nativeSessionId: sessionId });
    live.chat = { ...live.chat, nativeSessionId: sessionId };
    const segment = live.segments++;
    ctx.history.writeLine(live, {
      ts: Date.now() - chat.createdAt,
      dir: 'meta',
      line: {
        skaro: 'segment',
        agent: 'skaro',
        adapterVersion: ctx.deps.builtinChatSessions!.adapterVersion,
      },
    });
    const bound = AbortSignal.any([combined, prepared.host.signal]);
    session = await startBuiltinNativeSession(
      prepared.config,
      ctx.deps.attachments.dir,
      {
        ...options,
        signal: bound,
        processStarted(pid, identity) {
          if (!identity) throw new Error('Builtin chat process has no OS identity');
          options.processStarted!(pid, identity);
          lease.recordOwnership({ pid, ...identity });
        },
      },
      { ...prepared.host, signal: bound },
    );
    await lease.requireActive(lease.admission, bound);
    return { session, segment, resume, signal };
  } catch (error) {
    try {
      if (!live.builtinClose) prepared?.close();
    } finally {
      const owned = await revokeNativeSession(live, 'Builtin chat startup failed');
      try {
        await session?.close();
      } finally {
        await processes.stop(`chat.${chat.id}`);
        await confirmNativeSessionExit(live, owned);
      }
    }
    throw error;
  }
}
