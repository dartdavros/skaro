<script lang="ts">
  import type { TimelineState } from '@skaro/timeline';
  import { Banner, t } from '@skaro/ui';
  import type { AgentInfo } from '../../../shared/ipc';
  import { clock } from '../feed/context.svelte';
  import { agentName } from '../feed/format';

  /** Over the feed: sign-in, usage limit, agent download (mockup 8a). */
  let {
    agent,
    limits,
    error,
    ondismiss,
  }: {
    agent: AgentInfo | undefined;
    limits: TimelineState['limits'];
    error?: string;
    ondismiss: () => void;
  } = $props();

  const name = $derived(agent ? agentName(agent.id) : '');
  // The reset time, with the date when it is not today (a weekly window).
  const until = $derived.by(() => {
    if (!limits?.resetsAt) return '';
    const at = new Date(limits.resetsAt);
    const today = at.toDateString() === new Date(clock.now).toDateString();
    const time = at.toLocaleString([], {
      ...(today ? {} : { day: 'numeric', month: 'short' }),
      hour: '2-digit',
      minute: '2-digit',
    });
    return t('banner.until', { time });
  });
  // A limit is news only until its reset: after that the agent has a fresh allowance even if it
  // has not said so yet (it reports limits only while it works).
  const limit = $derived(
    limits && !(limits.resetsAt && Date.parse(limits.resetsAt) <= clock.now) ? limits.state : 'ok',
  );
  const mb = (n: number) => Math.round(n / 1e6);
</script>

{#if agent?.download}
  <div class="download">
    <div class="row">
      <span class="text">
        {t('banner.download', {
          agent: name,
          a: mb(agent.download.received),
          b: mb(agent.download.total ?? agent.sizeBytes),
        })}
      </span>
    </div>
    <div class="bar">
      <span
        style="width: {Math.round(
          (agent.download.received / (agent.download.total ?? agent.sizeBytes)) * 100,
        )}%"
      ></span>
    </div>
  </div>
{:else if agent && agent.installed && agent.authenticated === false}
  <Banner
    kind="warning"
    text={t('banner.auth', { agent: name })}
    action={t('agent.login')}
    onaction={() => void window.skaro.invoke('agents.login', agent.id)}
  />
{:else if limit === 'exhausted'}
  <Banner kind="warning" text={t('banner.limit', { agent: name, until })} />
{:else if limit === 'warning'}
  <Banner kind="warning" text={t('banner.limitSoon', { agent: name, until })} />
{/if}
{#if agent?.error && !agent.download && !agent.installed}
  <Banner
    kind="error"
    text={t('banner.downloadError', { agent: name, error: agent.error })}
    action={t('banner.retry')}
    onaction={() => void window.skaro.invoke('agents.install', agent.id)}
  />
{/if}
{#if error}
  <Banner kind="error" text={t('banner.error', { error })} onclose={ondismiss} />
{/if}

<style>
  .download {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 10px;
    background: var(--sk-white-a4);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .text {
    flex: 1;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-13);
  }

  .bar {
    height: 4px;
    border-radius: 3px;
    background: var(--sk-fill-20);
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: var(--sk-fill-40);
    transition: width 0.6s ease;
  }
</style>
