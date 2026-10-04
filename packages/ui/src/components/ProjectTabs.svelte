<script lang="ts" module>
  export interface ProjectTab {
    id: string;
    label: string;
    state?: 'working' | 'attention' | 'none';
  }
</script>

<script lang="ts">
  import './project-tabs.css';
  import { t } from '../i18n.svelte.ts';
  import Icon from './Icon.svelte';
  import StatusDot from './StatusDot.svelte';

  /**
   * 08 · Навигация: project tabs in the top bar. The active tab has the left sidebar colour,
   * a border on the left, top and right, and rounded bottom corners. No numbers in tabs.
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

<div class="tabs project-tabs" role="tablist">
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
