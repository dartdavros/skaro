<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import AgentLogo from './AgentLogo.svelte';
  import Checkbox from './Checkbox.svelte';
  import StatusDot, { type DotState } from './StatusDot.svelte';

  /**
   * 09 · Карточки задач: all cards are the same, only the indicator top right differs. Title,
   * milestone, then time on the left and the agent logo on the right. Click opens the task,
   * selection is only by the checkbox (shown on hover or when selected).
   */
  let {
    title,
    stage,
    time,
    agent,
    state = 'none',
    stateTip,
    selected = $bindable(false),
    onopen,
  }: {
    title: string;
    stage?: string;
    time?: string;
    agent?: 'claude-code' | 'codex';
    state?: DotState;
    stateTip?: string;
    selected?: boolean;
    onopen?: () => void;
  } = $props();
</script>

<div
  class="card"
  class:selected
  role="button"
  tabindex="0"
  onclick={onopen}
  onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && onopen?.()}
>
  <div class="top">
    <span class="check">
      <Checkbox bind:checked={selected} tip={selected ? t('card.unselect') : t('card.select')} />
    </span>
    <span class="title">{title}</span>
    <span class="state"><StatusDot {state} tip={stateTip} /></span>
  </div>
  {#if stage}<span class="stage">{stage}</span>{/if}
  <div class="bottom">
    <span class="time">{time ?? ''}</span>
    {#if agent}<span data-tip={agent === 'codex' ? 'Codex' : 'Claude Code'}
        ><AgentLogo {agent} /></span
      >{/if}
  </div>
</div>

<style>
  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 11px 12px 10px;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface);
    cursor: pointer;
    outline: none;
  }

  .card:hover {
    background: var(--sk-surface-hover);
  }

  .card:focus-visible {
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }

  .card.selected {
    background: #1e1e1e;
    box-shadow: inset 0 0 0 1px #3b3b3b;
  }

  .top {
    display: flex;
    align-items: flex-start;
    gap: 9px;
  }

  .check {
    flex: none;
    margin-top: 1px;
    width: 16px;
    opacity: 0;
    transition: opacity 0.1s;
  }

  .card:hover .check,
  .card.selected .check,
  .check:focus-within {
    opacity: 1;
  }

  .title {
    flex: 1;
    min-width: 0;
    font-size: 13.5px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--sk-text);
    text-wrap: pretty;
  }

  .state {
    flex: none;
    margin-top: 4px;
    display: inline-flex;
  }

  .stage,
  .bottom {
    padding-left: 25px;
  }

  .stage {
    font-size: 12px;
    color: var(--sk-text-muted);
  }

  .bottom {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .time {
    font-size: 11.5px;
    color: var(--sk-text-label);
  }
</style>
