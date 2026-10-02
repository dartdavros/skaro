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
  import { t } from '../i18n.svelte.ts';

  /**
   * "Активные" at the bottom of the left panel: needs an answer, in review, in progress. In the
   * collapsed rail only the status dots are left, with the same tooltip on the right.
   */
  let {
    tasks,
    rail = false,
    onopen,
  }: { tasks: NavTask[]; rail?: boolean; onopen: (id: string) => void } = $props();
</script>

{#if rail}
  <div class="nav-active-rail">
    {#each tasks as task (task.id)}
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
    {/each}
  </div>
{:else}
  <div class="nav-active">
    <span class="nav-active-head"
      ><span class="nav-active-label">{t('nav.active')}</span><span class="nav-active-count"
        >{tasks.length}</span
      ></span
    >
    <div class="nav-active-list">
      {#each tasks as task (task.id)}
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
          <span class="nav-task-dot {task.kind}"></span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .nav-active {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-height: 0;
    max-height: 45%;
  }

  .nav-active-head {
    flex: none;
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 0 10px 6px;
  }

  .nav-active-label {
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--sk-text-26);
  }

  .nav-active-count {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-1);
    color: var(--sk-text-28);
  }

  .nav-active-list {
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .nav-task {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 30px;
    padding: 4px 8px 4px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    font: inherit;
    cursor: pointer;
  }

  .nav-task:hover,
  .rail-task:hover {
    background: var(--sk-hover);
  }

  .nav-task-title {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-13);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-task-dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .nav-task-dot.need {
    background: var(--sk-accent);
  }

  .nav-task-dot.review {
    box-shadow: inset 0 0 0 1.5px var(--sk-accent);
  }

  .nav-task-dot.working {
    background: var(--sk-fill-41);
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .nav-active-rail {
    flex: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-height: 0;
    max-height: 45%;
    overflow-y: auto;
  }

  .rail-task {
    flex: none;
    width: 32px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    cursor: pointer;
  }
</style>
