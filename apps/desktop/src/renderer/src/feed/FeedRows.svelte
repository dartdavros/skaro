<script lang="ts">
  import { groupFeedRows, type FeedRow } from '@skaro/timeline';
  import './action-rows.css';
  import ActionGroup from './ActionGroup.svelte';
  import AgentMessage from './AgentMessage.svelte';
  import CommandRow from './CommandRow.svelte';
  import DecisionRow from './DecisionRow.svelte';
  import ExploreGroup from './ExploreGroup.svelte';
  import FileRow from './FileRow.svelte';
  import ImageRow from './ImageRow.svelte';
  import ImportPrepRow from './ImportPrepRow.svelte';
  import NoticeRow from './NoticeRow.svelte';
  import ProposalCard from './ProposalCard.svelte';
  import QuestionCard from './QuestionCard.svelte';
  import Reasoning from './Reasoning.svelte';
  import TaskRow from './TaskRow.svelte';
  import ToolRow from './ToolRow.svelte';
  import TurnEnd from './TurnEnd.svelte';
  import UserMessage from './UserMessage.svelte';
  import UnknownRow from './UnknownRow.svelte';

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
  /** The row before `i`, skipping proposal cards (they sit between the reply and its end). */
  function before(i: number): FeedRow | undefined {
    let j = i - 1;
    while (rows[j]?.type === 'proposal') j--;
    return rows[j];
  }

  /** Final answers directly followed by the turn summary: the summary carries their actions. */
  const replyBeforeEnd = $derived.by(() => {
    const map: Record<
      string,
      { text: string; retryOf?: { id: string; text: string } | undefined }
    > = {};
    rows.forEach((row, i) => {
      const prev = before(i);
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
      rows.flatMap((row, i) => {
        if (row.type !== 'turn_end') return [];
        const prev = before(i);
        return prev?.type === 'agent' ? [prev.id] : [];
      }),
    ),
  );
  const lastTurnEnd = $derived(rows.findLast((r) => r.type === 'turn_end')?.id);

  const blocks = $derived(groupFeedRows(rows));
</script>

{#snippet single(row: FeedRow)}
  {#if row.type === 'user'}
    {#if !row.hidden}<UserMessage {row} />{/if}
  {:else if row.type === 'question'}
    <QuestionCard interaction={row.interaction} />
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
  {:else if row.type === 'unknown'}
    <UnknownRow {row} />
  {:else if row.type === 'turn_end'}
    <TurnEnd {row} last={row.id === lastTurnEnd} reply={replyBeforeEnd[row.id]} />
  {:else if row.type === 'decision'}
    <DecisionRow {row} />
  {:else if row.type === 'proposal'}
    <ProposalCard {row} />
  {:else if row.type === 'import_prep'}
    <ImportPrepRow {row} />
  {/if}
{/snippet}

{#each blocks as block (block.id)}
  {#if block.type === 'actions'}
    <ActionGroup group={block} {waiting}>
      {#snippet children(row)}{@render single(row)}{/snippet}
    </ActionGroup>
  {:else}
    {@render single(block.row)}
  {/if}
{/each}
