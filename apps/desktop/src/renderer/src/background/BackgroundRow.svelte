<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import type { BackgroundJob } from '../../../shared/background';
  import './i18n';

  /** One piece of Skaro's own work: what happened, why, its outcome and the time it ended. */
  let { job }: { job: BackgroundJob } = $props();
  const time = (at: number) =>
    new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const stage = $derived(
    job.state === 'running' ? 'job' : job.state === 'failed' ? 'fail' : 'done',
  );
  // What this work is for, what it achieved and how often it ran; a failure says why instead.
  const detail = $derived(
    job.state === 'failed'
      ? (job.error ?? '')
      : [
          t(`background.about.${job.what}`),
          job.result ? t(`background.result.${job.result.what}`, job.result.params) : '',
          job.runs ? t('background.runs', { n: job.runs }) : '',
        ]
          .filter(Boolean)
          .join(' · '),
  );
</script>

<div class="row" class:failed={job.state === 'failed'}>
  <span class="mark">
    {#if job.state === 'running'}
      <LoadingIndicator size={14} />
    {:else if job.state === 'failed'}
      <Icon name="error" size={14} />
    {:else}
      <Icon name="check" size={14} />
    {/if}
  </span>
  <span class="text">
    <span class="what">{t(`background.${stage}.${job.what}`, job.params)}</span>
    {#if detail}<span class="outcome">{detail}</span>{/if}
  </span>
  <span class="time">
    {#if job.state === 'running'}
      {job.progress !== undefined ? `${job.progress}%` : time(job.startedAt)}
    {:else if job.endedAt}
      {time(job.endedAt)}
    {/if}
  </span>
</div>

<style>
  .row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    min-height: 20px;
    font-size: var(--sk-fs-6);
  }
  .mark {
    flex: none;
    display: inline-flex;
    width: 14px;
    margin-top: 2px;
    color: var(--sk-text-secondary);
  }
  .failed .mark,
  .failed .outcome {
    color: var(--sk-error);
  }
  .text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .what,
  .outcome {
    overflow-wrap: anywhere;
  }
  .outcome {
    font-size: var(--sk-fs-5);
    color: var(--sk-text-secondary);
  }
  .time {
    flex: none;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-secondary);
    font-variant-numeric: tabular-nums;
  }
</style>
