import type { SkaroScope } from '@skaro/timeline';
import type { ChatEngine } from './chat-engine';
import type { LiveChat } from './chat-model';
import { NativeAdmissions } from './native/admissions';

export function builtinChatScope(ctx: ChatEngine, live: LiveChat): SkaroScope {
  const imported = ctx.importReview.importRecord(live.chat.id);
  return {
    kind: 'project_chat',
    projectId: live.projectId,
    chatId: live.chat.id,
    ...(imported ? { importId: imported.id } : {}),
  };
}

/** A real chat and its current operation lifetime own this lease; no task authority is implied. */
export async function builtinChatAdmission(
  ctx: ChatEngine,
  live: LiveChat,
  sessionId: string,
  signal: AbortSignal,
) {
  const scope = builtinChatScope(ctx, live);
  const ticket = live.operation.capture();
  const current = (signal: AbortSignal) => {
    signal.throwIfAborted();
    live.operation.assert(ticket);
    const saved = ctx.deps.db.getChat(live.chat.id);
    if (
      ctx.closing ||
      live.stopping ||
      live.stopError ||
      live.chat.archived ||
      ctx.live.get(live.chat.id) !== live ||
      live.chat.agent !== 'skaro' ||
      !saved ||
      saved.projectId !== scope.projectId ||
      saved.agent !== 'skaro' ||
      saved.archived ||
      (saved.nativeSessionId && saved.nativeSessionId !== sessionId) ||
      (live.chat.nativeSessionId && live.chat.nativeSessionId !== sessionId) ||
      JSON.stringify(builtinChatScope(ctx, live)) !== JSON.stringify(scope)
    )
      throw new Error('Builtin chat admission is no longer current');
    signal.throwIfAborted();
  };
  await current(signal);
  if (live.builtinAdmission) throw new Error('This chat already owns a builtin admission');
  const ownerKey = `chat:${scope.projectId}:${scope.chatId}`;
  await NativeAdmissions.recover(ctx.deps.db, ownerKey, signal);
  await current(signal);
  const lease = await NativeAdmissions.prepare({
    db: ctx.deps.db,
    ownerKey,
    sessionId,
    scope,
    requireCurrent: async (signal) => current(signal),
    signal,
  });
  try {
    await current(signal);
    if (live.builtinAdmission) throw new Error('Builtin chat admission was already attached');
    live.builtinAdmission = lease;
    return { lease, scope, requireCurrent: current };
  } catch (error) {
    await lease.revoke(lease.admission, 'Chat changed while preparing admission');
    await lease.confirmExit(lease.admission);
    throw error;
  }
}
