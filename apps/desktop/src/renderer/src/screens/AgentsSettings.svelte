<script lang="ts">
  import type { AgentModel, AgentUserConfig } from '@skaro/timeline';
  import { AgentLogo, EffortSlider, Select, t, tn } from '@skaro/ui';
  import { agentDefaultsKey, type AgentId, type AgentInfo } from '../../../shared/ipc';
  import { agentName } from '../feed/format';

  /**
   * "Настройки" → "Агенты" (Settings mockup): each agent with its pinned version and state,
   * download, sign-in, default model and effort, and the user's own agent settings Skaro
   * connects to every run (D-25): MCP servers with their state, skills, hooks. Without a ready
   * agent Skaro does nothing.
   */
  let { agents }: { agents: AgentInfo[] } = $props();

  let models = $state<Partial<Record<AgentId, AgentModel[]>>>({});
  let defaults = $state<Partial<Record<AgentId, { model?: string; effort?: string }>>>({});
  let spin = $state<Partial<Record<AgentId, number>>>({});
  let busy = $state<Partial<Record<AgentId, boolean>>>({});
  /** "Ваши настройки агента", read for the install state it was read with. */
  let configs = $state<
    Partial<Record<AgentId, { installed: boolean; value?: AgentUserConfig; failed?: boolean }>>
  >({});

  $effect(() => {
    for (const a of agents) {
      if (a.checking || a.download) continue;
      if (configs[a.id]?.installed !== a.installed) void loadConfig(a.id, a.installed);
    }
  });

  async function loadConfig(id: AgentId, installed: boolean): Promise<void> {
    configs[id] = { installed };
    try {
      const value = await window.skaro.invoke('agents.config', id);
      if (configs[id]?.installed === installed) configs[id] = { installed, value };
    } catch {
      if (configs[id]?.installed === installed) configs[id] = { installed, failed: true };
    }
  }

  /** The home folder shows as "~": C:/Users/anna/.claude → ~/.claude. */
  function shortDir(dir: string): string {
    const path = dir.replace(/\\/g, '/');
    return path.replace(/^(?:[A-Za-z]:)?\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
  }

  function mcpView(server: AgentUserConfig['mcp'][number]): {
    dot: string;
    meta: string;
    color: string;
    tip: string;
  } {
    switch (server.state) {
      case 'ok':
        return {
          dot: 'var(--sk-fill-41)',
          meta: tn('settings.mcp.tools', server.tools),
          color: 'var(--sk-text-22)',
          tip: t('settings.mcp.ok.tip'),
        };
      case 'needs_auth':
        return {
          dot: 'var(--sk-warn)',
          meta: t('settings.mcp.auth'),
          color: 'var(--sk-warn)',
          tip: t('settings.mcp.auth.tip'),
        };
      case 'disabled':
        return {
          dot: 'var(--sk-fill-36)',
          meta: t('settings.mcp.disabled'),
          color: 'var(--sk-text-22)',
          tip: t('settings.mcp.disabled'),
        };
      default:
        return {
          dot: 'var(--sk-error)',
          meta: t('settings.mcp.failed'),
          color: 'var(--sk-error)',
          tip: server.error ?? t('settings.mcp.failed.tip'),
        };
    }
  }

  // Models come from the agent itself, so only a downloaded agent has them.
  $effect(() => {
    for (const a of agents) {
      if (a.installed && !models[a.id]) void loadModels(a.id);
    }
  });

  async function loadModels(id: AgentId): Promise<void> {
    const saved = (await window.skaro.invoke('app.getSetting', agentDefaultsKey(id))) as {
      model?: string;
      effort?: string;
    } | null;
    defaults[id] = saved ?? {};
    try {
      models[id] = await window.skaro.invoke('agents.models', id, '');
    } catch {
      models[id] = [];
    }
  }

  function modelOf(id: AgentId): AgentModel | undefined {
    const list = models[id] ?? [];
    return (
      list.find((m) => m.id === defaults[id]?.model) ?? list.find((m) => m.isDefault) ?? list[0]
    );
  }

  function effortLabel(id: string): string {
    const key = `effort.${id}`;
    const text = t(key);
    return text === key ? id : text;
  }

  function save(id: AgentId, next: { model?: string; effort?: string }): void {
    defaults[id] = next;
    void window.skaro.invoke('app.setSetting', agentDefaultsKey(id), next);
  }

  async function run(id: AgentId, action: () => Promise<unknown>): Promise<void> {
    busy[id] = true;
    try {
      await action();
    } catch {
      // The agent card shows the state the main process reports.
    } finally {
      busy[id] = false;
    }
  }

  function stateOf(a: AgentInfo): { text: string; dot: string; pulse: boolean; tip: string } {
    const mb = (n: number) => Math.round(n / 1e6);
    if (a.download) {
      return {
        text: t('settings.agent.loading', {
          a: mb(a.download.received),
          b: mb(a.download.total ?? a.sizeBytes),
        }),
        dot: 'var(--sk-fill-41)',
        pulse: true,
        tip: t('settings.agent.loading.tip'),
      };
    }
    if (a.checking)
      return { text: t('agent.state.checking'), dot: 'var(--sk-fill-36)', pulse: true, tip: '' };
    if (!a.installed)
      return {
        text: t('settings.agent.notLoaded', { mb: mb(a.sizeBytes) }),
        dot: 'var(--sk-fill-36)',
        pulse: false,
        tip: t('settings.agent.notLoaded.tip'),
      };
    if (a.authenticated === false)
      return {
        text: t('agent.state.signin'),
        dot: 'var(--sk-warn)',
        pulse: false,
        tip: t('agent.state.signin'),
      };
    return {
      text: t('settings.agent.ready'),
      dot: 'var(--sk-fill-41)',
      pulse: false,
      tip: t('agent.state.ready'),
    };
  }
</script>

<div class="section">
  <span class="sk-label">{t('settings.agents')}</span>
  <div class="agents">
    {#each agents as a (a.id)}
      {@const s = stateOf(a)}
      {@const config = configs[a.id]}
      {@const model = modelOf(a.id)}
      {@const efforts = (model?.efforts ?? []).map((e) => ({
        id: e.id,
        label: effortLabel(e.id),
      }))}
      <div class="agent">
        <div class="head">
          <AgentLogo agent={a.id} size={24} />
          <div class="titles">
            <span class="name-line"
              ><span class="name">{agentName(a.id)}</span>{#if a.version}<span
                  class="version"
                  data-tip={t('settings.agent.version.tip')}>{a.version}</span
                >{/if}</span
            >
            <span class="state"
              ><span
                class="dot"
                class:pulse={s.pulse}
                style="background: {s.dot}"
                data-tip={s.tip || undefined}
              ></span>{s.text}</span
            >
          </div>
          {#if !a.installed && !a.download && !a.checking}
            <button
              type="button"
              class="btn"
              disabled={busy[a.id]}
              onclick={() => void run(a.id, () => window.skaro.invoke('agents.install', a.id))}
              >{t('settings.agent.download')}</button
            >
          {/if}
          <button
            type="button"
            class="recheck"
            data-tip={t('settings.agent.recheck')}
            aria-label={t('settings.agent.recheck')}
            onclick={() => {
              spin[a.id] = (spin[a.id] ?? 0) + 360;
              void window.skaro.invoke('agents.refresh').then(() => loadConfig(a.id, a.installed));
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="1.9"
              stroke-linecap="round"
              stroke-linejoin="round"
              style="transform: rotate({spin[a.id] ?? 0}deg); transition: transform 0.5s"
              ><path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path><path
                d="M21 3v5h-5"
              ></path><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path><path
                d="M8 16H3v5"
              ></path></svg
            >
          </button>
        </div>
        {#if a.download}
          {@const total = a.download.total ?? a.sizeBytes}
          <div class="progress">
            <div class="track">
              <div
                class="fill"
                style="width: {Math.min(100, Math.round((a.download.received / total) * 100))}%"
              ></div>
            </div>
            <span class="progress-text"
              >{Math.round(a.download.received / 1e6)} / {Math.round(total / 1e6)} МБ</span
            >
          </div>
        {/if}
        <div class="divider"></div>
        <div class="grid">
          <span class="key">{t('settings.agent.account')}</span>
          <div class="value">
            {#if a.installed && a.authenticated !== false}
              <span class="account"
                >{#if a.account}{t('settings.agent.signedIn')}
                  <span class="mono">{a.account}</span>{:else}{t(
                    'settings.agent.signedInNoAccount',
                  )}{/if}</span
              >
            {:else}
              <span class="need-login">{t('settings.agent.signedOut')}</span>
              <button
                type="button"
                class="btn"
                disabled={!a.installed || busy[a.id]}
                data-tip={t('settings.agent.login.tip')}
                onclick={() => void run(a.id, () => window.skaro.invoke('agents.login', a.id))}
                >{t('agent.login')}</button
              >
            {/if}
          </div>
          <span class="key">{t('settings.agent.model')}</span>
          {#if models[a.id]?.length}
            <Select
              variant="model"
              width={280}
              menuWidth={280}
              label={t('settings.agent.model')}
              bind:value={() => model?.id ?? '', (v) => save(a.id, { model: v, effort: undefined })}
              options={(models[a.id] ?? []).map((m) => ({
                value: m.id,
                label: m.name,
                description: m.description,
                ...(m.isDefault ? { tag: t('agent.model.default') } : {}),
              }))}
            />
          {:else}
            <span class="field-off">{t('settings.agent.model.off')}</span>
          {/if}
          <span class="key">{t('settings.agent.effort')}</span>
          {#if efforts.length > 1}
            {@const effortDefault =
              model?.defaultEffort ?? efforts[Math.floor(efforts.length / 2)]!.id}
            <div class="field-width">
              <EffortSlider
                levels={efforts}
                bind:value={
                  () =>
                    efforts.some((e) => e.id === defaults[a.id]?.effort)
                      ? defaults[a.id]!.effort!
                      : effortDefault,
                  (v) =>
                    save(a.id, {
                      ...(model ? { model: model.id } : {}),
                      effort: v,
                    })
                }
                defaultValue={effortDefault}
              />
            </div>
          {:else}
            <span class="field-off">{t('settings.agent.model.off')}</span>
          {/if}
        </div>
        {#if config}
          <div class="divider"></div>
          <div class="cfg">
            <div class="cfg-head">
              <span class="cfg-title" data-tip={t('settings.cfg.tip')}
                >{t('settings.cfg')}{#if config.value}&nbsp;·&nbsp;<span class="cfg-dir"
                    >{shortDir(config.value.dir)}</span
                  >{/if}</span
              >
              <button
                type="button"
                class="cfg-open"
                onclick={() => void window.skaro.invoke('agents.openConfigDir', a.id)}
                >{t('settings.cfg.open')}</button
              >
            </div>
            {#if !a.installed && !config.value}
              <span class="cfg-note">{t('settings.cfg.notLoaded')}</span>
            {:else if config.failed}
              <span class="cfg-note">{t('settings.cfg.failed')}</span>
            {:else if !config.value}
              <span class="cfg-note">{t('agent.state.checking')}</span>
            {:else}
              {#if config.value.mcp.length}
                <div class="mcp">
                  {#each config.value.mcp as server (server.name)}
                    {@const v = mcpView(server)}
                    <div class="mcp-row">
                      <span class="mcp-dot" style="background: {v.dot}" data-tip={v.tip}></span>
                      <span class="mcp-name">{server.name}</span>
                      <span class="mcp-meta" style="color: {v.color}">{v.meta}</span>
                    </div>
                  {/each}
                </div>
              {/if}
              <span class="cfg-counts"
                >{t('settings.cfg.skills')} · <span class="mono">{config.value.skills}</span>&nbsp;
                · &nbsp;{t('settings.cfg.hooks')} ·
                <span class="mono">{config.value.hooks}</span></span
              >
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .section {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px 15px 16px;
    border-radius: 10px;
    background: var(--sk-fill-16);
  }

  .agents {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .agent {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px;
    border-radius: 10px;
    background: var(--sk-fill-8);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .titles {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .name-line {
    display: flex;
    align-items: baseline;
    gap: 9px;
  }

  .name {
    font-size: var(--sk-fs-8);
    font-weight: 700;
    color: var(--sk-text-6);
  }

  .version {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
    cursor: default;
  }

  .state {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-19);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .dot.pulse {
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .btn {
    flex: none;
    height: 28px;
    padding: 0 12px;
    border: none;
    border-radius: 7px;
    background: var(--sk-fill-23);
    color: var(--sk-text-6);
    font: inherit;
    font-size: var(--sk-fs-4);
    font-weight: 600;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    background: var(--sk-fill-28);
    color: var(--sk-text-2);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .recheck {
    flex: none;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-19);
    cursor: pointer;
  }

  .recheck:hover {
    background: var(--sk-fill-20);
    color: var(--sk-text-2);
  }

  .progress {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .track {
    flex: 1;
    height: 4px;
    border-radius: 3px;
    background: var(--sk-fill-20);
    overflow: hidden;
  }

  .fill {
    height: 100%;
    border-radius: 3px;
    background: var(--sk-fill-40);
    transition: width 0.6s ease;
  }

  .progress-text {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .divider {
    height: 1px;
    background: var(--sk-fill-19);
  }

  .grid {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 14px 16px;
    align-items: center;
  }

  .key {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-19);
  }

  .value {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 28px;
  }

  .account {
    font-size: var(--sk-fs-5);
    color: var(--sk-text-7);
  }

  .mono {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
  }

  .need-login {
    flex: 1;
    font-size: var(--sk-fs-5);
    color: var(--sk-warn);
  }

  /* The effort slider is as wide as the model select. */
  /* "Ваши настройки агента" (Settings mockup). */
  .cfg {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .cfg-head {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .cfg-title {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-5);
    font-weight: 600;
    color: var(--sk-text-7);
    cursor: default;
  }

  .cfg-dir {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    font-weight: 400;
    color: var(--sk-text-19);
  }

  .cfg-open {
    flex: none;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: var(--sk-fs-4);
    font-weight: 600;
    color: var(--sk-accent);
    cursor: pointer;
  }

  .cfg-open:hover {
    color: var(--sk-teal-1);
    text-decoration: underline;
  }

  .cfg-note,
  .cfg-counts {
    font-size: var(--sk-fs-4);
    color: var(--sk-text-19);
  }

  .mcp {
    display: flex;
    flex-direction: column;
  }

  .mcp-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 2px;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
  }

  .mcp-dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .mcp-name {
    flex: 1;
    min-width: 0;
    color: var(--sk-text-13);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mcp-meta {
    flex: none;
  }

  .field-width {
    width: 280px;
    max-width: 100%;
  }

  .field-off {
    width: 280px;
    max-width: 100%;
    height: 34px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    border-radius: 8px;
    background: var(--sk-fill-3);
    color: var(--sk-text-23);
    font-size: var(--sk-fs-5);
    font-weight: 600;
  }
</style>
