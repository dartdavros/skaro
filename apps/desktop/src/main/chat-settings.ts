import { type ChatRecord } from '@skaro/core';
import type { AgentId, ChatSettings } from '../shared/ipc';
import { saved, lastOf, settingsKey, lastKey } from './chat-settings-helpers';

import type { ChatEngine } from './chat-engine';

export class ChatConfiguration {
  private readonly ctx: ChatEngine;
  constructor(ctx: ChatEngine) {
    this.ctx = ctx;
  }
  /** Model, effort and permission mode change in a live session; the agent itself never changes. */
  async setSettings(projectId: string, chatId: string, next: ChatSettings): Promise<void> {
    const live = await this.ctx.history.restore(projectId, chatId);
    if (next.agent !== live.chat.agent) {
      throw new Error('The agent of a started chat cannot be changed');
    }
    const before = this.settings(live.chat);
    if (
      live.session &&
      next.model &&
      (next.model !== before.model || next.effort !== before.effort)
    )
      await live.session.setModel(next.model, next.effort);
    const mode = next.permissionMode ?? 'ask';
    if (live.session && mode !== (before.permissionMode ?? 'ask'))
      await live.session.setPermissionMode(mode);
    this.ctx.deps.db.setSetting(settingsKey(chatId), saved(next));
    this.ctx.deps.db.setSetting(lastKey(projectId), lastOf(next));
    this.ctx.listChanged(projectId, chatId);
  }

  // ── plumbing ─────────────────────────────────────────────────────────────

  settings(chat: ChatRecord): ChatSettings {
    const stored = this.ctx.deps.db.getSetting<Omit<ChatSettings, 'agent'> | null>(
      settingsKey(chat.id),
      null,
    );
    return {
      agent: chat.agent === 'codex' ? 'codex' : 'claude-code',
      ...(stored ? saved(stored) : {}),
    };
  }

  /** Model and effort are always explicit, never inherited (agent-output.md 9.1). */
  async withDefaults(agent: AgentId, cwd: string, settings: ChatSettings): Promise<ChatSettings> {
    // Defaults from Settings → Agents come first, then the agent's own default.
    const preset = this.ctx.deps.agents.defaults(agent);
    if (!settings.model && preset.model) {
      settings = {
        ...settings,
        model: preset.model,
        ...(preset.effort && !settings.effort ? { effort: preset.effort } : {}),
      };
    }
    if (settings.model && settings.effort) return settings;
    const models = await this.ctx.deps.agents.listModels(agent, cwd).catch(() => []);
    const model =
      models.find((m) => m.id === settings.model) ?? models.find((m) => m.isDefault) ?? models[0];
    if (!model) return settings;
    const effort =
      settings.effort ??
      model.defaultEffort ??
      (model.efforts.some((e) => e.id === 'medium') ? 'medium' : model.efforts[0]?.id);
    return { ...settings, model: model.id, ...(effort ? { effort } : {}) };
  }

  /** An absent agent is inactive: nothing starts until it is downloaded and signed in. */
  async ensureAgent(agent: AgentId): Promise<void> {
    await this.ctx.deps.agents.requireReady(agent);
  }
}
