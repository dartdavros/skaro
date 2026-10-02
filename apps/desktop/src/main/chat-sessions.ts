import { segmentTurns, type AgentSession } from '@skaro/timeline';
import type { AgentId } from '../shared/ipc';
import { hasCode } from './new-project';
import { chatInstructions, importInstructions } from './prompt';
import { errorText } from './session-log';
import { LiveChat } from './chat-model';

import type { ChatEngine } from './chat-engine';

export class ChatSessions {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  // ── sessions ─────────────────────────────────────────────────────────────

  attach(live: LiveChat): Promise<AgentSession> {
    if (live.session) return Promise.resolve(live.session);
    live.attaching ??= this.startSession(live).finally(() => (live.attaching = undefined));
    return live.attaching;
  }

  async startSession(live: LiveChat): Promise<AgentSession> {
    const { projectId, chat } = live;
    const context = this.ctx.project(projectId);
    const artifacts = await context.load();
    const agent = chat.agent as AgentId;
    await this.ctx.settings.ensureAgent(agent);
    const settings = await this.ctx.settings.withDefaults(
      agent,
      context.root,
      this.ctx.settings.settings(chat),
    );
    // Codex runs its sandbox in the mode the self-check chose (D-28).
    const sandbox =
      agent === 'codex'
        ? await this.ctx.deps.agents.sandbox(agent).catch(() => undefined)
        : undefined;
    const adapter = this.ctx.deps.agents.adapter(agent);
    const resume = chat.nativeSessionId;

    const segment = live.segments++;
    this.ctx.history.writeLine(live, {
      ts: Date.now() - chat.createdAt,
      dir: 'meta',
      line: { skaro: 'segment', agent, adapterVersion: adapter.adapterVersion },
    });
    const imported = this.ctx.importReview.importRecord(chat.id);
    live.grant = this.ctx.deps.mcp.grant({
      kind: 'project_chat',
      projectId,
      chatId: chat.id,
      ...(imported ? { importId: imported.id } : {}),
    });
    const instructions = imported
      ? importInstructions({
          projectName: this.ctx.deps.db.getProject(projectId)?.name ?? '',
          root: context.root,
          artifacts,
          locale: this.ctx.deps.locale(),
          dir: imported.dir,
          hasCode: await hasCode(context.root),
        })
      : chatInstructions({
          projectName: this.ctx.deps.db.getProject(projectId)?.name ?? '',
          root: context.root,
          artifacts,
          locale: this.ctx.deps.locale(),
        });
    let session: AgentSession;
    try {
      session = await adapter.start({
        cwd: context.root,
        ...(settings.model ? { model: settings.model } : {}),
        ...(settings.effort ? { effort: settings.effort } : {}),
        permissionMode: settings.permissionMode ?? 'ask',
        planFirst: false,
        instructions,
        ...(imported ? { readDirs: [imported.dir] } : {}),
        mcpServers: {
          skaro: {
            type: 'http',
            url: live.grant.url,
            headers: live.grant.headers,
            trusted: true,
          },
        },
        ...(sandbox ? { sandboxVerified: sandbox.holds } : {}),
        ...(sandbox?.mode ? { sandboxMode: sandbox.mode } : {}),
        ...(resume ? { resume } : {}),
        raw: (line) =>
          this.ctx.history.writeLine(live, { ...line, ts: Date.now() - chat.createdAt }),
        context: this.ctx.deps.attachments.context(),
      });
    } catch (error) {
      live.grant.revoke();
      live.grant = undefined;
      if (resume) this.ctx.history.notice(live, 'session_lost', 'error', errorText(error));
      throw error;
    }
    live.session = session;
    if (resume) this.ctx.history.notice(live, 'session_restored', 'info', '');
    void this.pump(live, session, segment);
    return session;
  }

  async pump(live: LiveChat, session: AgentSession, segment: number): Promise<void> {
    try {
      for await (const event of session.events) {
        this.ctx.history.onEvent(live, segmentTurns(segment, event));
      }
    } catch (error) {
      this.ctx.history.failTurn(live, error);
    }
    if (live.session === session) {
      live.session = undefined;
      live.grant?.revoke();
      live.grant = undefined;
      const turn = live.timeline.state.turns.at(-1);
      if (turn && !turn.outcome)
        this.ctx.history.failTurn(live, new Error('The agent process exited'));
      this.ctx.listChanged(live.projectId, live.chat.id);
    }
  }

  async detach(live: LiveChat): Promise<void> {
    const session = live.session;
    live.session = undefined;
    live.grant?.revoke();
    live.grant = undefined;
    await session?.close().catch(() => undefined);
    this.ctx.history.flush(live);
  }

  async close(): Promise<void> {
    await Promise.all([...this.ctx.live.values()].map((l) => this.detach(l)));
    for (const live of this.ctx.live.values()) live.log?.end();
  }
}
