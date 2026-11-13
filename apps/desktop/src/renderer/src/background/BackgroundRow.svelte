<script lang="ts">
  import { CircleHelp } from '@lucide/svelte';
  import { background } from './background.svelte';
  import { Icon, t } from '@skaro/ui';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import type { BackgroundJob } from '../../../shared/background';
  import './i18n';
  import C4AuditRow from '../c4/C4AuditRow.svelte';

  /** One piece of Skaro's own work: what happened, why, its outcome and the time it ended. */
  let { job, onchat }: { job: BackgroundJob; onchat?: (project: string, chat: string) => void } =
    $props();
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

{#if job.audit}<C4AuditRow value={job.audit} {onchat} />{:else}
  <div class="row" class:failed={job.state === 'failed'}>
    <span class="mark">
      {#if job.decisionId}<CircleHelp size={14} />
      {:else if job.state === 'running'}
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
      {#if job.taskId || job.resourceId}<span class="outcome">{job.taskId ?? job.resourceId}</span
        >{/if}
      {#if job.decisionId}<button class="decision-link" onclick={() => background.openDecision()}
          ><CircleHelp size={16} />{t('background.openDecision')}</button
        >{/if}
    </span>
    <span class="time">
      {#if !job.decisionId}
        {#if job.state === 'running'}
          {job.progress !== undefined ? `${job.progress}%` : time(job.startedAt)}
        {:else if job.endedAt}
          {time(job.endedAt)}
        {/if}
      {/if}
    </span>
  </div>
{/if}

<style>
  .decision-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--sk-link);
    font: inherit;
    font-size: var(--sk-fs-4);
    text-align: left;
    cursor: pointer;
  }
  .outcome {
    overflow-wrap: anywhere;
  }

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
