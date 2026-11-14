<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import { SHUTDOWN_STAGES, type ShutdownState } from '../../../shared/shutdown';
  let { state }: { state: ShutdownState } = $props();
</script>

<details class="shutdown-details">
  <summary><span>{t('shutdown.details')}</span><Icon name="chevronDown" size={13} /></summary>
  <ol aria-label={t('shutdown.stages')}>
    {#each SHUTDOWN_STAGES as stage (stage)}
      {@const done = state.completed.includes(stage)}
      {@const active = state.stage === stage}
      <li class:done class:active aria-current={active ? 'step' : undefined}>
        <span class="step-icon" aria-hidden="true">
          {#if done}<Icon name="check" size={14} stroke={1.8} />{:else}<span class="step-dot"
            ></span>{/if}
        </span>
        <span>{t(`shutdown.stage.${stage}`)}</span>
        <span class="step-label"
          >{done ? t('shutdown.done') : active ? t('shutdown.working') : ''}</span
        >
      </li>
    {/each}
  </ol>
</details>

<style>
  .shutdown-details {
    width: 100%;
    margin-top: 6px;
  }
  summary {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    color: var(--sk-text-muted);
    font-size: var(--sk-fs-4);
    list-style: none;
    cursor: pointer;
    user-select: none;
  }
  summary::-webkit-details-marker {
    display: none;
  }
  summary:hover {
    color: var(--sk-text);
  }
  details[open] summary :global(svg) {
    transform: rotate(180deg);
  }
  ol {
    margin: 18px 0 0;
    padding: 14px 0 0;
    border-top: 1px solid var(--sk-line);
    display: grid;
    gap: 10px;
    list-style: none;
  }
  li {
    display: grid;
    grid-template-columns: 16px minmax(0, 1fr) auto;
    align-items: center;
    gap: 9px;
    color: var(--shutdown-dim);
    font-size: var(--sk-fs-4);
  }
  li.active {
    color: var(--sk-text);
  }
  li.done {
    color: var(--sk-text-muted);
  }
  .step-icon {
    width: 16px;
    height: 16px;
    display: grid;
    place-items: center;
  }
  .step-dot {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
  }
  .active .step-dot {
    width: 6px;
    height: 6px;
  }
  .step-label {
    color: var(--sk-text-muted);
    font-size: var(--sk-fs-2);
  }
  @media (max-width: 520px) {
    li {
      grid-template-columns: 16px minmax(0, 1fr);
    }
    .step-label {
      display: none;
    }
  }
  @media (pointer: coarse) {
    summary {
      min-height: 44px;
    }
  }
</style>
