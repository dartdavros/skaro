<script lang="ts">
  import type { TimelineState } from '@skaro/timeline';
  import { Banner, t } from '@skaro/ui';
  import type { AgentInfo } from '../../../shared/ipc';
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
  const until = $derived(
    limits?.resetsAt
      ? t('banner.until', {
          time: new Date(limits.resetsAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          }),
        })
      : '',
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
{:else if limits?.state === 'exhausted'}
  <Banner kind="warning" text={t('banner.limit', { agent: name, until })} />
{:else if limits?.state === 'warning'}
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
    background: rgba(255, 255, 255, 0.04);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .text {
    flex: 1;
    font-size: 12.5px;
    color: #a6a6a6;
  }

  .bar {
    height: 4px;
    border-radius: 3px;
    background: #242424;
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    border-radius: 3px;
    background: #8a8a8a;
    transition: width 0.6s ease;
  }
</style>
