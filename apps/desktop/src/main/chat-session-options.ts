import type { ProjectArtifacts } from '@skaro/core';
import type { SessionOptions } from '@skaro/timeline';
import type { ChatSettings } from '../shared/ipc';
import type { ChatEngine } from './chat-engine';
import type { LiveChat } from './chat-model';
import { hasCode } from './new-project';
import { chatInstructions, importInstructions } from './prompt';

/** Existing chat/import instructions and history sinks shared by managed and bundled sessions. */
export async function chatSessionOptions(
  ctx: ChatEngine,
  live: LiveChat,
  artifacts: ProjectArtifacts,
  settings: Pick<ChatSettings, 'model' | 'effort' | 'permissionMode'>,
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
  const instructions = imported
    ? importInstructions({ ...common, dir: imported.dir, hasCode: await hasCode(context.root) })
    : chatInstructions(common);
  return {
    signal: live.operation.signal,
    cwd: context.root,
    processStarted,
    ...(settings.model ? { model: settings.model } : {}),
    ...(settings.effort ? { effort: settings.effort } : {}),
    permissionMode: settings.permissionMode ?? 'ask',
    planFirst: false,
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
