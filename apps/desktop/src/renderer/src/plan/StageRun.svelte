<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { StageInfo } from '../../../shared/ipc';
  import { stageAction, stageLine } from './stage-state';
  import './stage-run.css';

  /**
   * The state line and the run button of a stage in the header of its milestone ("План - этапы"
   * mockup, A1 and A2). The line stands where the marks of the tasks were.
   */
  let {
    part,
    info,
    slotsFree,
    onrun,
  }: {
    /** The line stands before the progress of the milestone, the button after it. */
    part: 'state' | 'button';
    info: StageInfo;
    slotsFree: boolean;
    onrun: (action: 'run' | 'stop') => void;
  } = $props();

  const line = $derived(stageLine(info));
  const button = $derived(stageAction(info, slotsFree));
  // Not started and its first task waits for a task of another stage.
  const waits = $derived(info.state === 'idle' ? info.waitsFor : undefined);
  const tip = $derived(
    waits
      ? t(waits.stage ? 'plan.run.waits' : 'plan.run.waitsTask', waits)
      : info.state === 'idle'
        ? t('plan.run.tip')
        : undefined,
  );
</script>

{#if part === 'state' && line}
  <span data-plan-stage class="state {line.tone}">
    {#if line.mark === 'clock' || line.mark === 'stop'}
      <Icon name={line.mark === 'clock' ? 'clock' : 'stopSquare'} size={12} stroke={2} />
    {:else}
      <span data-plan-stage class="state-dot {line.mark}" class:live={line.live}></span>
    {/if}
    <span>
      {line.lead}{#if line.task}
        <span data-plan-stage class="state-task" class:bright={line.tone === 'plain'}
          >{line.task}</span
        >{/if}{#if line.tail}
        {line.tail}{/if}
    </span>
  </span>
{/if}
{#if part === 'button' && button}
  <!-- The button neither toggles nor drags the milestone. -->
  <button
    data-plan-stage
    type="button"
    class="run"
    disabled={!!waits}
    data-tip={tip}
    onclick={(e) => {
      e.stopPropagation();
      onrun(button.action);
    }}
    onpointerdown={(e) => e.stopPropagation()}
  >
    <Icon name={button.icon} size={12} stroke={2} />{button.label}
  </button>
{/if}
