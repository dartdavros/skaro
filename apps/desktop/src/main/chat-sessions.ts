import { agentDefinition } from '@skaro/agents';
import { operationTimeout, segmentTurns, type AgentSession } from '@skaro/timeline';
import type { AgentId } from '../shared/ipc';
import { hasCode } from './new-project';
import { chatInstructions, importInstructions } from './prompt';
import { errorText } from './session-log';
import { LiveChat } from './chat-model';
import { closeSessionLog } from './close-session-log';
import { TaskRunProcesses } from './task-run-processes';
import { CommandCancelled } from './owner-commands';

import type { ChatEngine } from './chat-engine';

export class ChatSessions {
  private readonly ctx: ChatEngine;
  private readonly processes: TaskRunProcesses;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
    this.processes = new TaskRunProcesses(ctx.deps.db);
  }
  // ── sessions ─────────────────────────────────────────────────────────────

  attach(live: LiveChat): Promise<AgentSession> {
    if (live.stopping || live.stopError)
      return Promise.reject(new Error(live.stopError ?? 'Chat is stopping'));
    live.operation.signal.throwIfAborted();
    if (live.session) return Promise.resolve(live.session);
    live.attaching ??= this.startSession(live).finally(() => (live.attaching = undefined));
    return live.attaching;
  }

  async startSession(live: LiveChat): Promise<AgentSession> {
    const { projectId, chat } = live;
    const signal = live.operation.signal;
    signal.throwIfAborted();
    await this.processes.stop(`chat.${chat.id}`);
    const context = this.ctx.project(projectId);
    // Instructions use presence, ids and configuration; document bodies remain available to tools.
    const artifacts = await context.summary();
    const agent = chat.agent as AgentId;
    await this.ctx.settings.ensureAgent(agent);
    const settings = await this.ctx.settings.withDefaults(
      agent,
      context.root,
      this.ctx.settings.settings(chat),
    );
    // Codex runs its sandbox in the mode the self-check chose (D-28).
    const sandbox = agentDefinition(agent).chatSandboxCheck
      ? await this.ctx.deps.agents.sandbox(agent).catch(() => undefined)
      : undefined;
    const adapter = this.ctx.deps.agents.adapter(agent);
    const resume = chat.nativeSessionId;
    signal.throwIfAborted();
    if (live.chat.archived) throw new CommandCancelled();

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
        signal,
        cwd: context.root,
        processStarted: (pid, identity) =>
          this.processes.started(`chat.${chat.id}`, pid, false, identity),
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
        rawSerialized: (line) => this.ctx.history.writeLine(live, line),
        rawScope: { startedAt: chat.createdAt },
        secretValues: () => live.secrets.list(),
        context: this.ctx.deps.attachments.context(),
      });
    } catch (error) {
      live.grant?.revoke();
      live.grant = undefined;
      if (resume) this.ctx.history.notice(live, 'session_lost', 'error', errorText(error));
      throw error;
    }
    if (live.chat.archived || signal.aborted) {
      await session.close();
      live.grant?.revoke();
      live.grant = undefined;
      throw new CommandCancelled();
    }
    live.session = session;
    if (resume) this.ctx.history.notice(live, 'session_restored', 'info', '');
    live.pumping = this.pump(live, session, segment);
    return session;
  }

  async pump(live: LiveChat, session: AgentSession, segment: number): Promise<void> {
    try {
      for await (const event of session.events) {
        const projected = segmentTurns(segment, event);
        this.ctx.history.onEvent(live, projected);
        this.ctx.planningContinuation.onEvent(live, projected);
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
    this.ctx.planningContinuation.userMessage(live);
    const session = live.session;
    const attaching = live.attaching;
    const pumping = live.pumping;
    live.operation.cancel(new CommandCancelled());
    live.session = undefined;
    live.grant?.revoke();
    live.grant = undefined;
    try {
      await operationTimeout(
        Promise.all([
          this.ctx.planningContinuation.settled(live),
          session?.close(),
          attaching?.then(
            (attached) => attached.close(),
            (error: unknown) => {
              if (!(error instanceof CommandCancelled) && !live.operation.signal.aborted)
                throw error;
            },
          ),
        ]).then(async () => {
          await pumping;
        }),
        15_000,
        'Agent session shutdown was not confirmed',
      );
    } finally {
      await this.processes.stop(`chat.${live.chat.id}`);
    }
    this.ctx.history.flush(live);
    if (!live.stopping && !live.stopError) live.operation.renew();
  }

  async close(): Promise<void> {
    await Promise.all([...this.ctx.live.values()].map((l) => this.detach(l)));
    await Promise.all([...this.ctx.live.values()].map((live) => closeSessionLog(live.log)));
  }
}
