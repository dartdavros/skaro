<script lang="ts" module>
  import type { NavItem as NavItemType } from './nav-model';
  export type NavItem = NavItemType;
</script>

<script lang="ts">
  import './nav-panel.css';
  import type { Snippet } from 'svelte';
  import { t } from '../i18n.svelte.ts';
  import Icon from './Icon.svelte';
  import NavActiveTasks, { type NavTask } from './NavActiveTasks.svelte';
  import PanelResizer from './PanelResizer.svelte';

  /**
   * Left panel with the project sections; collapses into a rail. "Чат" is separated by a line.
   * Counters live only here (tasks needing attention), never in tabs. Below the sections —
   * the tasks that need the user or run ("Активные").
   */

  let {
    title,
    logo,
    items,
    active,
    collapsed = $bindable(false),
    width = $bindable(216),
    tasks = [],
    taskCount,
    taskContent,
    onresize,
    onselect,
    ontask,
    footerItem,
    footerContent,
    onfooter,
  }: {
    title: string;
    /** The project's logo (a data: URL), before the title. */
    logo?: string | undefined;
    items: NavItem[];
    active: string;
    collapsed?: boolean;
    width?: number;
    /** "Активные": needs an answer, then in review, then in progress. */
    tasks?: NavTask[];
    taskCount?: number;
    taskContent?: Snippet<[Snippet<[NavTask, Snippet?]>, boolean]>;
    onresize?: () => void;
    onselect: (id: string) => void;
    ontask?: (id: string) => void;
    footerItem?: NavItem;
    footerContent?: Snippet<[boolean]>;
    onfooter?: () => void;
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
        aria-current={item.id === active ? 'page' : undefined}
        onclick={() => onselect(item.id)}
      >
        <span class="icon"><Icon name={item.icon} size={16} /></span>
        <span class="label">{item.label}</span>
        {#if item.count}<span class="count">{item.count}</span>{/if}
      </button>
    {/each}
    <span class="spacer"></span>
    {#if taskCount ?? tasks.length}<NavActiveTasks
        {tasks}
        count={taskCount}
        content={taskContent}
        onopen={(id) => ontask?.(id)}
      />{/if}
    {#if footerContent || footerItem}
      <div class="sep"></div>
      {#if footerContent}{@render footerContent(false)}{:else if footerItem}
        <button type="button" class="item footer-item" onclick={onfooter}>
          <span class="icon"><Icon name={footerItem.icon} size={16} /></span>
          <span class="label">{footerItem.label}</span>
          {#if footerItem.trailing}<span class="count">{footerItem.trailing}</span>{/if}
        </button>
      {/if}
    {/if}
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
        <Icon name={item.icon} size={16} />
        {#if item.count}<span class="badge"></span>{/if}
      </button>
    {/each}
    <span class="spacer"></span>
    {#if taskCount ?? tasks.length}<NavActiveTasks
        {tasks}
        count={taskCount}
        content={taskContent}
        rail
        onopen={(id) => ontask?.(id)}
      />{/if}
    {#if footerContent || footerItem}
      <div class="rail-sep"></div>
      {#if footerContent}{@render footerContent(true)}{:else if footerItem}
        <button
          type="button"
          class="rail-item"
          onclick={onfooter}
          data-tip={footerItem.trailing
            ? `${footerItem.label} · ${footerItem.trailing}`
            : footerItem.label}
          aria-label={footerItem.label}
        >
          <Icon name={footerItem.icon} size={16} />
        </button>
      {/if}
    {/if}
  </nav>
{/if}
