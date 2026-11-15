<script lang="ts" module>
  /** A task that needs the user or runs, listed under the sections of the left panel. */
  export interface NavTask {
    id: string;
    /** The title in the list. */
    title: string;
    /** First line of the tooltip: "T5 · full title". */
    tip: string;
    /** Second line of the tooltip: status and milestone. */
    sub: string;
    /** "need" — a filled accent dot, "review" — an accent ring, "working" — a pulsing grey dot. */
    kind: 'need' | 'review' | 'working';
  }
</script>

<script lang="ts">
  import type { Snippet } from 'svelte';
  import { t } from '../i18n.svelte.ts';
  import './nav-active-tasks.css';
  let {
    tasks,
    rail = false,
    count,
    content,
    onopen,
  }: {
    tasks: NavTask[];
    rail?: boolean;
    count?: number;
    content?: Snippet<[Snippet<[NavTask, Snippet?]>, boolean]>;
    onopen(id: string): void;
  } = $props();
</script>

{#snippet row(task: NavTask, indicator?: Snippet)}
  {#if rail}
    <button
      type="button"
      class="rail-task"
      data-tip={task.tip}
      data-tip-side="right"
      data-tip-sub={task.sub}
      data-tip-dot={task.kind}
      aria-label={task.tip}
      onclick={() => onopen(task.id)}
    >
      <span class="nav-task-dot {task.kind}"></span>
    </button>
  {:else}
    <button
      type="button"
      class="nav-task"
      data-tip={task.tip}
      data-tip-side="right"
      data-tip-sub={task.sub}
      data-tip-dot={task.kind}
      onclick={() => onopen(task.id)}
    >
      <span class="nav-task-title">{task.title}</span>
      {#if indicator && task.kind === 'working'}
        {@render indicator()}
      {:else}
        <span class="nav-task-dot {task.kind}"></span>
      {/if}
    </button>
  {/if}
{/snippet}
{#if rail}
  <div class="nav-active-rail">
    {#if content}{@render content(row, true)}{:else}{#each tasks as task (task.id)}{@render row(
          task,
        )}{/each}{/if}
  </div>
{:else}
  <div class="nav-active">
    <span class="nav-active-head"
      ><span class="nav-active-label">{t('nav.active')}</span><span class="nav-active-count"
        >{count ?? tasks.length}</span
      ></span
    >
    <div class="nav-active-list">
      {#if content}{@render content(row, false)}{:else}{#each tasks as task (task.id)}{@render row(
            task,
          )}{/each}{/if}
    </div>
  </div>
{/if}
