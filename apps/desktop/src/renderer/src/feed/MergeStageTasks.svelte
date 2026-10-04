<script lang="ts">
  import type { StageMerge } from '@skaro/timeline';
  import { Icon, t, tn } from '@skaro/ui';

  /**
   * The tasks of a stage merge card ("Слияние этапа" mockup): a folding list, each task with
   * the message of its commit. The messages are edited while nothing blocks the merge.
   */
  let {
    stage,
    editable,
    messages = $bindable(),
  }: {
    stage: StageMerge;
    editable: boolean;
    /** Messages as the user left them, by task id. */
    messages: Record<string, string>;
  } = $props();

  /** Rows shown before "ещё N". */
  const FIRST = 4;
  // An editable list starts open: the messages are what the user is asked to look at.
  let open = $derived(editable);
  let all = $state(false);

  const shown = $derived(all ? stage.tasks : stage.tasks.slice(0, FIRST));
  const rest = $derived(stage.tasks.slice(shown.length));
</script>

<div class="stage-tasks" class:quiet={!editable}>
  <button type="button" class="toggle" aria-expanded={open} onclick={() => (open = !open)}>
    <span class="chev" class:open><Icon name="chevronRight" size={12} stroke={2.2} /></span>
    {tn('card.merge.stage.tasks', stage.tasks.length)}
    {#if editable}
      <span class="hint"
        >· {t(stage.partial ? 'card.merge.stage.finished' : 'card.merge.stage.messages')}</span
      >
    {/if}
  </button>
  {#if open}
    <div class="rows">
      {#each shown as task (task.id)}
        <div class="row">
          <span class="id">{task.id}</span>
          <span class="title">{task.title}</span>
          <span></span>
          <input
            class="fd-input"
            type="text"
            aria-label={t('card.merge.message')}
            disabled={!editable}
            value={messages[task.id] ?? task.message}
            oninput={(e) => (messages[task.id] = e.currentTarget.value)}
          />
        </div>
      {/each}
      {#if rest.length}
        <button type="button" class="more" onclick={() => (all = true)}>
          {t('card.merge.stage.more', {
            n: rest.length,
            from: rest[0]!.id,
            to: rest.at(-1)!.id,
          })}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .stage-tasks {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .toggle {
    display: inline-flex;
    align-items: center;
    align-self: flex-start;
    gap: 7px;
    padding: 0;
    border: none;
    background: none;
    color: var(--sk-text);
    font: inherit;
    font-size: var(--sk-fs-4);
    cursor: pointer;
  }

  .quiet .toggle {
    color: var(--sk-text-secondary);
  }

  .chev {
    display: inline-flex;
    color: var(--sk-text-muted);
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .hint {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-label);
  }

  .rows {
    margin-left: 19px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 4px 0;
  }

  .row {
    display: grid;
    grid-template-columns: 50px minmax(0, 1fr);
    gap: 4px 10px;
    align-items: center;
    padding: 6px 0;
  }

  .id {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    color: var(--sk-text-19);
  }

  .title {
    font-size: var(--sk-fs-5);
    color: var(--sk-text);
  }

  .row .fd-input {
    width: 100%;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-bright);
  }

  .more {
    align-self: flex-start;
    padding: 6px 0 2px 60px;
    border: none;
    background: none;
    color: var(--sk-text-label);
    font: inherit;
    font-size: var(--sk-fs-3);
    cursor: pointer;
  }
</style>
