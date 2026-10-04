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
  }: {
    rows: FeedRow[];
    /** Items with an open permission request (blue dot). */
    waiting: ReadonlySet<string>;
  } = $props();

  /**
   * The final answer of each finished turn: the turn summary carries its actions. Rows in between
   * (proposal cards, a reconnect notice) do not detach it; a user message starts another turn.
   */
  const replyOfEnd = $derived.by(() => {
    const map: Record<string, Extract<FeedRow, { type: 'agent' }>> = {};
    rows.forEach((row, i) => {
      if (row.type !== 'turn_end') return;
      for (let j = i - 1; j >= 0 && rows[j]!.type !== 'user' && rows[j]!.type !== 'turn_end'; j--) {
        const prev = rows[j]!;
        if (prev.type === 'agent') {
          if (prev.final) map[row.id] = prev;
          break;
        }
      }
    });
    return map;
  });
  const endsAfter = $derived(new Set(Object.values(replyOfEnd).map((reply) => reply.id)));
  const lastTurnEnd = $derived(rows.findLast((r) => r.type === 'turn_end')?.id);

  const blocks = $derived(groupFeedRows(rows));
</script>

{#snippet single(row: FeedRow)}
  {#if row.type === 'user'}
    {#if !row.hidden}<UserMessage {row} />{/if}
  {:else if row.type === 'question'}
    <QuestionCard interaction={row.interaction} />
  {:else if row.type === 'agent'}
    <AgentMessage {row} actions={!endsAfter.has(row.id)} />
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
    <TurnEnd {row} last={row.id === lastTurnEnd} reply={replyOfEnd[row.id]?.item.text} />
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
