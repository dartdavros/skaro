import { agentDefinition } from '@skaro/agents';
import { operationTimeout, segmentTurns, type AgentSession } from '@skaro/timeline';
import type { AgentId } from '../shared/ipc';
import { errorText } from './session-log';
import { LiveChat } from './chat-model';
import { closeSessionLog } from './close-session-log';
import { TaskRunProcesses } from './task-run-processes';
import { CommandCancelled } from './owner-commands';

import type { ChatEngine } from './chat-engine';
import { chatSessionOptions } from './chat-session-options';
import { startBuiltinChatSession } from './builtin-chat-session';
import { retireNativeSession } from './native/session-retirement';

export class ChatSessions {
  private readonly ctx: ChatEngine;
  private readonly processes: TaskRunProcesses;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
    this.processes = new TaskRunProcesses(ctx.deps.db);
  }
  // ── sessions ─────────────────────────────────────────────────────────────

  attach(live: LiveChat): Promise<AgentSession> {
    if (this.ctx.closing) return Promise.reject(new Error('Chat controller is closing.'));
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
    if (chat.agent === 'skaro') {
      const started = await startBuiltinChatSession(this.ctx, live);
      return this.publish(live, started.session, started.segment, !!started.resume, started.signal);
    }
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
    let session: AgentSession;
    try {
      const options = await chatSessionOptions(
        this.ctx,
        live,
        artifacts,
        settings,
        (pid, identity) => this.processes.started(`chat.${chat.id}`, pid, false, identity),
      );
      session = await adapter.start({
        ...options,
        ...(sandbox ? { sandboxVerified: sandbox.holds } : {}),
        ...(sandbox?.mode ? { sandboxMode: sandbox.mode } : {}),
      });
    } catch (error) {
      live.grant?.revoke();
      live.grant = undefined;
      if (resume) this.ctx.history.notice(live, 'session_lost', 'error', errorText(error));
      throw error;
    }
    return this.publish(live, session, segment, !!resume, signal);
  }

  private async publish(
    live: LiveChat,
    session: AgentSession,
    segment: number,
    resume: boolean,
    signal: AbortSignal,
  ) {
    const saved = this.ctx.deps.db.getChat(live.chat.id);
    if (
      this.ctx.closing ||
      live.chat.archived ||
      signal.aborted ||
      this.ctx.live.get(live.chat.id) !== live ||
      !saved ||
      saved.archived ||
      saved.projectId !== live.projectId ||
      saved.agent !== live.chat.agent
    ) {
      live.grant?.revoke();
      live.grant = undefined;
      await retireNativeSession(live, 'Chat changed during startup', async () => {
        try {
          await session.close();
        } finally {
          await this.processes.stop(`chat.${live.chat.id}`);
        }
      });
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
        const projected = segmentTurns(live.chat.agent === 'skaro' ? 0 : segment, event);
        this.ctx.history.onEvent(live, projected);
        this.ctx.planningContinuation.onEvent(live, projected);
      }
    } catch (error) {
      this.ctx.history.failTurn(live, error);
    }
    if (live.session === session) {
      const builtin = !!live.builtinAdmission;
      live.session = undefined;
      const cleanup = async () => {
        live.grant?.revoke();
        live.grant = undefined;
        if (builtin) await this.processes.stop(`chat.${live.chat.id}`);
        const turn = live.timeline.state.turns.at(-1);
        if (turn && !turn.outcome)
          this.ctx.history.failTurn(live, new Error('The agent process exited'));
      };
      try {
        if (builtin) await retireNativeSession(live, 'Chat runtime exited', cleanup);
        else await cleanup();
      } catch (error) {
        live.stopError = errorText(error);
        this.ctx.history.notice(live, 'other', 'error', live.stopError);
      }
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
      await retireNativeSession(live, 'Chat detached', async () => {
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
      });
    } finally {
      this.ctx.history.flush(live);
    }
    if (!this.ctx.closing && !live.stopping && !live.stopError) live.operation.renew();
  }

  async close(): Promise<void> {
    this.ctx.closing = true;
    await Promise.all([...this.ctx.live.values()].map((l) => this.detach(l)));
    await Promise.all([...this.ctx.live.values()].map((live) => closeSessionLog(live.log)));
  }
}
