<script lang="ts" module>
  /**
   * 03 · Индикаторы состояния: a dot without text, the meaning is in the tooltip.
   * Working — grey pulsing; attention (answer, review, done) — blue; error — red; blocked — lock.
   */
  export type DotState = 'working' | 'attention' | 'error' | 'blocked' | 'idle' | 'done' | 'none';
</script>

<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import Icon from './Icon.svelte';

  let { state, tip }: { state: DotState; tip?: string } = $props();

  const defaultTips: Partial<Record<DotState, string>> = {
    working: 'status.working',
    attention: 'status.attention',
    error: 'status.error',
    blocked: 'status.blocked',
  };
  const text = $derived(tip ?? (defaultTips[state] ? t(defaultTips[state]!) : undefined));
</script>

{#if state === 'blocked'}
  <span class="lock" data-tip={text}><Icon name="lock" size={13} stroke={2} color="#8a8a8a" /></span
  >
{:else if state === 'working'}
  <span class="pulse" data-tip={text}>
    <span class="core"></span>
    <span class="ring"></span>
  </span>
{:else if state !== 'none'}
  <span class="dot {state}" data-tip={text}></span>
{/if}

<style>
  .lock {
    display: inline-flex;
  }

  .pulse {
    position: relative;
    display: inline-flex;
    flex: none;
    width: 7px;
    height: 7px;
  }

  .core,
  .ring {
    position: absolute;
    inset: 0;
    border-radius: 50%;
  }

  .core {
    background: var(--sk-text-secondary);
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .ring {
    border: 1px solid var(--sk-text-secondary);
    animation: skPulseRing 1.8s ease-out infinite;
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .attention {
    background: var(--sk-accent);
  }

  .error {
    background: var(--sk-error);
  }

  .idle {
    background: #4a4a4a;
  }

  .done {
    background: var(--sk-text-label);
  }
</style>
