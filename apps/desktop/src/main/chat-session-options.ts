import type { ProjectArtifacts } from '@skaro/core';
import type { SessionOptions } from '@skaro/timeline';
import type { ChatSettings } from '../shared/ipc';
import type { ChatEngine } from './chat-engine';
import type { LiveChat } from './chat-model';
import { hasCode } from './new-project';
import { chatInstructions, importInstructions } from './prompt';
import { chatContinuationKey } from './builtin-chat-rebind';
import { resourceSessionAdmission } from './resource-session';
import { projectMemory } from './project-memory-binding';
import { auditAdmission } from './c4-audit-admission';

/** Existing chat/import instructions and history sinks shared by managed and bundled sessions. */
export async function chatSessionOptions(
  ctx: ChatEngine,
  live: LiveChat,
  artifacts: ProjectArtifacts,
  settings: Pick<ChatSettings, 'model' | 'effort' | 'permissionMode' | 'budgetUsd'>,
  processStarted: NonNullable<SessionOptions['processStarted']>,
): Promise<SessionOptions> {
  const { projectId, chat } = live;
  const context = ctx.project(projectId);
  const imported = ctx.importReview.importRecord(chat.id);
  const common = {
    projectName: ctx.deps.db.getProject(projectId)?.name ?? '',
    root: context.root,
    artifacts,
    locale: ctx.deps.locale(),
  };
  let instructions = imported
    ? importInstructions({ ...common, dir: imported.dir, hasCode: await hasCode(context.root) })
    : chatInstructions(common);
  if (chat.agent === 'skaro') {
    const continuation = ctx.deps.db.getSetting<{ sessionId: string; context: string } | null>(
      chatContinuationKey(chat.id),
      null,
    );
    if (continuation && continuation.sessionId === chat.nativeSessionId)
      instructions += '\n\n' + continuation.context;
  }
  instructions += '\n\n' + ((await projectMemory(ctx.deps.db)?.note(projectId)) ?? '');
  return {
    resourceAdmission: resourceSessionAdmission(
      ctx.deps.db,
      projectId,
      `chat:${chat.id}`,
      `managed:${chat.agent}`,
      () => {
        live.operation.signal.throwIfAborted();
        if (ctx.closing || live.stopping || live.chat.archived)
          throw new Error('Chat resource authority changed');
      },
      context.root,
      `chat.${chat.id}`,
      auditAdmission(ctx, projectId, chat.id),
    ),
    signal: live.operation.signal,
    cwd: context.root,
    processStarted,
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
    ...(settings.budgetUsd !== undefined ? { budgetUsd: settings.budgetUsd } : {}),
    permissionMode: settings.permissionMode ?? 'ask',
    planFirst: false,
    ...(ctx.deps.db.getSetting(`c4.audit.chat.${chat.id}`, undefined) ? { readOnly: true } : {}),
    instructions,
    ...(imported ? { readDirs: [imported.dir] } : {}),
    mcpServers: live.grant
      ? {
          skaro: {
            type: 'http',
            url: live.grant.url,
            headers: live.grant.headers,
            trusted: true,
          },
        }
      : {},
    ...(chat.nativeSessionId ? { resume: chat.nativeSessionId } : {}),
    raw: (line) => ctx.history.writeLine(live, { ...line, ts: Date.now() - chat.createdAt }),
    rawSerialized: (line) => ctx.history.writeLine(live, line),
    rawScope: { startedAt: chat.createdAt },
    secretValues: () => live.secrets.list(),
    context: ctx.deps.attachments.context(),
  };
}
