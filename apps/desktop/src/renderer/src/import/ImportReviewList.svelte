<script lang="ts">
  import { t } from '@skaro/ui';
  import type { ImportReviewState } from './import-review-state.svelte';
  import { GROUPS } from './import-review-format';
  import ImportReviewRow from './ImportReviewRow.svelte';
  import ImportReviewGroup from './ImportReviewGroup.svelte';
  import ImportReviewNotes from './ImportReviewNotes.svelte';
  let { state }: { state: ImportReviewState } = $props();
</script>

<div class="list">
  <div class="rows">
    {#each state.core as item (item.key)}<ImportReviewRow {item} indent={false} {state} />{/each}
    {#each GROUPS as [type, label] (type)}
      {@const list = state.items.filter((i) => i.type === type)}
      {#if list.length}
        <ImportReviewGroup label={t(label)} {list} {state} />
        {#each list as item (item.key)}<ImportReviewRow {item} indent={false} {state} />{/each}
      {/if}
    {/each}
    {#if state.planItems.length}
      <ImportReviewGroup label={t('import.review.plan')} list={state.planItems} {state} />
      {#each state.milestones as m (m.key)}
        <ImportReviewRow item={m} indent={false} {state} />
        {#each state.tasksOf(m.key) as task (task.key)}<ImportReviewRow
            item={task}
            indent={true}
            {state}
          />{/each}
      {/each}
      {#if state.loose.length}
        <div class="sub">{t('import.review.loose')}</div>
        {#each state.loose as task (task.key)}<ImportReviewRow
            item={task}
            indent={true}
            {state}
          />{/each}
      {/if}
    {/if}

    <ImportReviewNotes {state} />
  </div>
</div>
