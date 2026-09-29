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
  import { t } from '../i18n.svelte.ts';
  import Icon from './Icon.svelte';

  /**
   * Right panel with the project sections; collapses into a rail. "Чат" is separated by a line.
   * Counters live only here (tasks needing attention), never in tabs.
   */

  let {
    title,
    logo,
    items,
    active,
    collapsed = $bindable(false),
    onselect,
  }: {
    title: string;
    /** The project's logo (a data: URL), before the title. */
    logo?: string | undefined;
    items: NavItem[];
    active: string;
    collapsed?: boolean;
    onselect: (id: string) => void;
  } = $props();
</script>

{#if !collapsed}
  <nav class="panel">
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
        <Icon name="panelCollapse" size={17} stroke={1.9} />
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
        <span class="icon"><Icon name={item.icon} size={15} /></span>
        <span class="label">{item.label}</span>
        {#if item.count}<span class="count" data-tip={item.countTip}>{item.count}</span>{/if}
      </button>
    {/each}
  </nav>
{:else}
  <nav class="rail">
    <button
      type="button"
      class="expand"
      data-tip={t('nav.expand')}
      aria-label={t('nav.expand')}
      onclick={() => (collapsed = false)}
    >
      <Icon name="panelExpand" size={17} stroke={1.9} />
    </button>
    {#each items as item (item.id)}
      {#if item.separated}<div class="rail-sep"></div>{/if}
      <button
        type="button"
        class="rail-item"
        class:active={item.id === active}
        data-tip={item.count && item.railTip ? item.railTip : item.label}
        aria-label={item.label}
        onclick={() => onselect(item.id)}
      >
        <Icon name={item.icon} size={15} />
        {#if item.count}<span class="badge"></span>{/if}
      </button>
    {/each}
  </nav>
{/if}

<style>
  .panel {
    flex: none;
    width: 216px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 18px 8px 14px;
    border-left: 1px solid var(--sk-surface);
    background: var(--sk-topbar);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 6px 8px 10px;
  }

  .logo {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    object-fit: contain;
  }

  .title {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--sk-text-26);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .toggle {
    flex: none;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-icon);
    cursor: pointer;
  }

  .toggle:hover {
    background: var(--sk-fill-13);
    color: var(--sk-text-bright);
  }

  .sep {
    height: 1px;
    margin: 9px 10px;
    background: var(--sk-fill-18);
  }

  .item {
    display: flex;
    align-items: center;
    gap: 11px;
    height: 32px;
    padding: 0 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-text-secondary);
    font-size: var(--sk-fs-8);
    text-align: left;
    cursor: pointer;
  }

  .item:hover {
    color: var(--sk-text-bright);
  }

  .item.active {
    color: var(--sk-text);
    font-weight: 600;
  }

  .icon {
    flex: none;
    width: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--sk-text-label);
  }

  .item.active .icon {
    color: var(--sk-text);
  }

  .label {
    flex: 1;
    min-width: 0;
  }

  .count {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-muted);
  }

  .rail {
    flex: none;
    width: 44px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: 18px 0 14px;
    border-left: 1px solid var(--sk-surface);
    background: var(--sk-topbar);
  }

  .expand {
    width: 28px;
    height: 28px;
    margin-bottom: 6px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: var(--sk-fill-13);
    color: var(--sk-text-body);
    cursor: pointer;
  }

  .expand:hover {
    color: var(--sk-text-bright);
  }

  .rail-sep {
    width: 20px;
    height: 1px;
    margin: 7px 0;
    background: var(--sk-fill-18);
  }

  .rail-item {
    position: relative;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-label);
    cursor: pointer;
  }

  .rail-item:hover {
    background: var(--sk-fill-13);
    color: var(--sk-text-bright);
  }

  .rail-item.active {
    color: var(--sk-text);
  }

  .badge {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--sk-accent);
  }
</style>
