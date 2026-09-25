<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import AgentMessage from './AgentMessage.svelte';
  import CommandRow from './CommandRow.svelte';
  import DecisionRow from './DecisionRow.svelte';
  import ExploreGroup from './ExploreGroup.svelte';
  import FileRow from './FileRow.svelte';
  import ImageRow from './ImageRow.svelte';
  import NoticeRow from './NoticeRow.svelte';
  import Reasoning from './Reasoning.svelte';
  import TaskRow from './TaskRow.svelte';
  import ToolRow from './ToolRow.svelte';
  import TurnEnd from './TurnEnd.svelte';
  import UserMessage from './UserMessage.svelte';

  /** Rows of a feed; the main feed and each subagent use it. */
  let {
    rows,
    waiting,
    nested = false,
  }: {
    rows: FeedRow[];
    /** Items with an open permission request (blue dot). */
    waiting: ReadonlySet<string>;
    nested?: boolean;
  } = $props();

  /** The user message that started each turn: "Повторить" under the final answer resends it. */
  const retryTargets = $derived.by(() => {
    const map: Record<string, { id: string; text: string }> = {};
    let last: { id: string; text: string } | undefined;
    for (const row of rows) {
      if (row.type === 'user') last = { id: row.item.id, text: row.item.text };
      else if (row.type === 'agent' && row.final && last) map[row.id] = last;
    }
    return map;
  });
  /** Final answers directly followed by the turn summary: the summary carries their actions. */
  const replyBeforeEnd = $derived.by(() => {
    const map: Record<
      string,
      { text: string; retryOf?: { id: string; text: string } | undefined }
    > = {};
    rows.forEach((row, i) => {
      const prev = rows[i - 1];
      if (row.type === 'turn_end' && prev?.type === 'agent' && prev.final) {
        map[row.id] = {
          text: prev.item.text,
          retryOf: nested ? undefined : retryTargets[prev.id],
        };
      }
    });
    return map;
  });
  const endsAfter = $derived(
    new Set(
      rows
        .filter((r, i) => r.type === 'agent' && rows[i + 1]?.type === 'turn_end')
        .map((r) => r.id),
    ),
  );
  const lastTurnEnd = $derived(rows.findLast((r) => r.type === 'turn_end')?.id);

  /** Edits and commands in a row form one tight block (mockup 1a); the rest stand alone. */
  const blocks = $derived.by(() => {
    const out: { id: string; rows: FeedRow[]; events: boolean }[] = [];
    for (const row of rows) {
      const event = row.type === 'file' || row.type === 'command';
      const last = out.at(-1);
      if (event && last?.events) last.rows.push(row);
      else out.push({ id: row.id, rows: [row], events: event });
    }
    return out;
  });
</script>

{#snippet single(row: FeedRow)}
  {#if row.type === 'user'}
    <UserMessage {row} />
  {:else if row.type === 'agent'}
    <AgentMessage
      {row}
      retryOf={nested ? undefined : retryTargets[row.id]}
      actions={!endsAfter.has(row.id)}
    />
  {:else if row.type === 'reasoning'}
    <Reasoning {row} />
  {:else if row.type === 'explore'}
    <ExploreGroup {row} />
  {:else if row.type === 'file'}
    <FileRow {row} waiting={row.items.some((i) => waiting.has(i.id))} />
  {:else if row.type === 'command'}
    <CommandRow {row} waiting={waiting.has(row.id)} />
  {:else if row.type === 'task'}
    <TaskRow {row} {waiting} />
  {:else if row.type === 'tool'}
    <ToolRow {row} waiting={waiting.has(row.id)} />
  {:else if row.type === 'image'}
    <ImageRow {row} />
  {:else if row.type === 'notice'}
    <NoticeRow {row} last={row.id === rows.at(-1)?.id} />
  {:else if row.type === 'turn_end'}
    <TurnEnd {row} last={row.id === lastTurnEnd} reply={replyBeforeEnd[row.id]} />
  {:else if row.type === 'decision'}
    <DecisionRow {row} />
  {/if}
{/snippet}

{#each blocks as block (block.id)}
  {#if block.events}
    <div class="fd-block">
      {#each block.rows as row (row.id)}{@render single(row)}{/each}
    </div>
  {:else}
    {@render single(block.rows[0]!)}
  {/if}
{/each}
