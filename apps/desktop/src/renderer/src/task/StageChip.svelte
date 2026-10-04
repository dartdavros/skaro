<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { StageInfo } from '../../../shared/ipc';
  import { stageLine } from '../plan/stage-state';
  import '../plan/i18n';

  /** State chip of the stage screen ("Экран этапа" mockup): the words of the plan in a chip. */
  let { info }: { info: StageInfo } = $props();
  const line = $derived(stageLine(info));
</script>

<span class="chip">
  {#if line}
    {#if line.mark === 'clock' || line.mark === 'stop'}
      <Icon name={line.mark === 'clock' ? 'clock' : 'stopSquare'} size={11} stroke={2} />
    {:else}
      <span class="dot {line.mark}" class:live={line.live}></span>
    {/if}
    <span
      >{line.lead}{#if line.task}
        <span class="task">{line.task}</span>{/if}{#if line.tail}
        {line.tail}{/if}</span
    >
  {:else if info.state === 'done'}
    <Icon name="check" size={11} stroke={2.6} />{t('plan.state.done')}
  {:else}
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      ><circle cx="12" cy="12" r="8" stroke-width="2" stroke-dasharray="3 3"></circle></svg
    >{t('plan.state.idle')}
  {/if}
</span>

<style>
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 22px;
    padding: 0 9px;
    align-self: flex-start;
    border-radius: 6px;
    background: var(--sk-fill-18);
    color: var(--sk-text-13);
    font-size: var(--sk-fs-4);
    font-weight: 600;
    white-space: nowrap;
  }

  .task {
    font-family: var(--sk-mono);
    font-weight: 400;
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sk-fill-41);
  }

  .dot.live {
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .dot.accent {
    background: var(--sk-accent);
  }

  .dot.error {
    background: var(--sk-error);
  }

  .dot.ring {
    background: none;
    box-shadow: inset 0 0 0 1.5px var(--sk-accent);
  }
</style>
