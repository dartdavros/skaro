<script lang="ts" module>
  export interface ProjectTab {
    id: string;
    label: string;
    state?: 'working' | 'attention' | 'none';
  }
</script>

<script lang="ts">
  import { t } from '../i18n.svelte.ts';
  import Icon from './Icon.svelte';
  import StatusDot from './StatusDot.svelte';

  /**
   * 08 · Навигация: project tabs in the top bar. The active tab has the main background colour,
   * a border on the left, top and right, and rounded bottom "ears". No numbers in tabs.
   */

  let {
    tabs,
    active,
    onselect,
    onclose,
    onadd,
  }: {
    tabs: ProjectTab[];
    active?: string;
    onselect: (id: string) => void;
    onclose: (id: string) => void;
    onadd: () => void;
  } = $props();
</script>

<div class="tabs" role="tablist">
  {#each tabs as tab (tab.id)}
    <div
      class="tab"
      class:active={tab.id === active}
      role="tab"
      tabindex="0"
      aria-selected={tab.id === active}
      onclick={() => onselect(tab.id)}
      onkeydown={(e) => e.key === 'Enter' && onselect(tab.id)}
      onauxclick={(e) => e.button === 1 && onclose(tab.id)}
    >
      {#if tab.state && tab.state !== 'none'}<StatusDot state={tab.state} />{/if}
      <span class="label">{tab.label}</span>
      <button
        type="button"
        class="close"
        data-tip={t('tabs.close')}
        aria-label={t('tabs.close')}
        onclick={(e) => {
          e.stopPropagation();
          onclose(tab.id);
        }}
      >
        <Icon name="close" size={12} stroke={2.2} />
      </button>
    </div>
  {/each}
  <button
    type="button"
    class="add"
    data-tip={t('tabs.open')}
    aria-label={t('tabs.open')}
    onclick={onadd}
  >
    <Icon name="plus" size={15} stroke={2.6} />
  </button>
</div>

<style>
  .tabs {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    min-width: 0;
    height: 100%;
  }

  .tab {
    position: relative;
    flex: 0 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 9px 0 11px;
    border-radius: 11px 11px 0 0;
    color: #9e9e9e;
    font-size: 13px;
    cursor: pointer;
    outline: none;
    -webkit-app-region: no-drag;
  }

  .tab:hover {
    background: #161616;
    color: var(--sk-text-bright);
  }

  .tab.active {
    z-index: 1;
    margin-bottom: -1px;
    padding: 0 11px 0 13px;
    background: var(--sk-bg);
    border: 1px solid var(--sk-surface-2);
    border-bottom: none;
    color: var(--sk-text);
    font-weight: 600;
  }

  /* Rounded "ears" joining the active tab with the content below. */
  .tab.active::before,
  .tab.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    width: 10px;
    height: 10px;
    border-bottom: 1px solid var(--sk-surface-2);
    pointer-events: none;
  }

  .tab.active::before {
    left: -11px;
    border-bottom-right-radius: 10px;
    border-right: 1px solid var(--sk-surface-2);
    box-shadow: 3px 3px 0 3px var(--sk-bg);
  }

  .tab.active::after {
    right: -11px;
    border-bottom-left-radius: 10px;
    border-left: 1px solid var(--sk-surface-2);
    box-shadow: -3px 3px 0 3px var(--sk-bg);
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .close {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--sk-text-muted);
    cursor: pointer;
  }

  .close:hover {
    background: #262626;
    color: var(--sk-text-bright);
  }

  .add {
    flex: none;
    width: 28px;
    height: 28px;
    margin-bottom: 2px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-icon);
    cursor: pointer;
    -webkit-app-region: no-drag;
  }

  .add:hover {
    background: #161616;
    color: var(--sk-text-bright);
  }
</style>
