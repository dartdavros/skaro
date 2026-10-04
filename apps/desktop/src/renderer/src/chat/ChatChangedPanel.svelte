<script lang="ts">
  import type { Item } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import { changedRows, type ProposalItem } from './changed-rows';
  import './chat-changed-panel.css';
  let { items }: { items: Item[] } = $props();
  const rows = $derived(changedRows(items.filter((i): i is ProposalItem => i.kind === 'proposal')));
  function reveal(item: ProposalItem): void {
    document
      .getElementById(`proposal-${item.id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
</script>

<div class="changed">
  <span class="sk-label changed-label">{t('chat.changed')}</span>
  <div class="changed-list">
    {#each rows as row (row.key)}
      {@const c = row.c}
      {@const item = row.item}
      <button
        type="button"
        class="changed-row"
        data-tip={c.pending ? t('chat.changed.pending.tip') : t('chat.changed.open.tip')}
        onclick={() => reveal(item)}
      >
        <span class="changed-icon"><Icon name={c.icon} size={13} stroke={1.8} /></span>
        <span class="changed-texts">
          <span class="changed-title">{c.title}</span>
          <span class="changed-note" class:pending={c.pending}>{c.note}</span>
        </span>
      </button>
    {/each}
    {#if !rows.length}
      <span class="changed-empty">{t('chat.changed.empty')}</span>
    {/if}
  </div>
</div>
