<script lang="ts" module>
  import type { IconName } from '../icons.ts';

  export interface NavItem {
    id: string;
    label: string;
    icon: IconName;
    tip?: string;
    count?: number;
    countTip?: string;
    /** Tooltip of the collapsed rail item when the count is shown. */
    railTip?: string;
    separated?: boolean;
  }
</script>

<script lang="ts">
  import './nav-panel.css';
  import { t } from '../i18n.svelte.ts';
  import Icon from './Icon.svelte';
  import PanelResizer from './PanelResizer.svelte';

  /**
   * Left panel with the project sections; collapses into a rail. "Чат" is separated by a line.
   * Counters live only here (tasks needing attention), never in tabs.
   */

  let {
    title,
    logo,
    items,
    active,
    collapsed = $bindable(false),
    width = $bindable(216),
    onresize,
    onselect,
  }: {
    title: string;
    /** The project's logo (a data: URL), before the title. */
    logo?: string | undefined;
    items: NavItem[];
    active: string;
    collapsed?: boolean;
    width?: number;
    onresize?: () => void;
    onselect: (id: string) => void;
  } = $props();
  const id = $props.id();
</script>

{#if !collapsed}
  <nav {id} class="panel project-nav" style="width: {width}px">
    <div class="head">
      {#if logo}<img class="logo" src={logo} alt="" />{/if}
      <span class="title">{title}</span>
      <button
        type="button"
        class="toggle"
        data-tip={t('nav.collapse')}
        aria-label={t('nav.collapse')}
        onclick={() => (collapsed = true)}
      >
        <span class="toggle-icon"><Icon name="panelCollapse" size={17} stroke={1.9} /></span>
      </button>
    </div>
    {#each items as item (item.id)}
      {#if item.separated}<div class="sep"></div>{/if}
      <button
        type="button"
        class="item"
        class:active={item.id === active}
        data-tip={item.tip}
        aria-current={item.id === active ? 'page' : undefined}
        onclick={() => onselect(item.id)}
      >
        <span class="icon"><Icon name={item.icon} size={17} /></span>
        <span class="label">{item.label}</span>
        {#if item.count}<span class="count" data-tip={item.countTip}>{item.count}</span>{/if}
      </button>
    {/each}
  </nav>
  <PanelResizer
    {width}
    min={180}
    max={520}
    side="left"
    controls={id}
    label={t('nav.resize')}
    onresize={(next) => (width = next)}
    oncommit={() => onresize?.()}
  />
{:else}
  <nav class="rail project-nav">
    <button
      type="button"
      class="expand"
      data-tip={t('nav.expand')}
      aria-label={t('nav.expand')}
      onclick={() => (collapsed = false)}
    >
      <span class="toggle-icon"><Icon name="panelExpand" size={17} stroke={1.9} /></span>
    </button>
    {#each items as item (item.id)}
      {#if item.separated}<div class="rail-sep"></div>{/if}
      <button
        type="button"
        class="rail-item"
        class:active={item.id === active}
        data-tip={item.count && item.railTip ? item.railTip : item.label}
        aria-label={item.label}
        aria-current={item.id === active ? 'page' : undefined}
        onclick={() => onselect(item.id)}
      >
        <Icon name={item.icon} size={17} />
        {#if item.count}<span class="badge"></span>{/if}
      </button>
    {/each}
  </nav>
{/if}
