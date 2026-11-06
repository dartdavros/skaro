<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { isPendingProposal } from '../../../shared/feed-actions';
  import type { HistoryRow } from '../../../shared/history';
  import AgentMessage from './AgentMessage.svelte';
  import CommandRow from './CommandRow.svelte';
  import DecisionRow from './DecisionRow.svelte';
  import ExploreGroup from './ExploreGroup.svelte';
  import FileRow from './FileRow.svelte';
  import ImageRow from './ImageRow.svelte';
  import ImportPrepRow from './ImportPrepRow.svelte';
  import NoticeRow from './NoticeRow.svelte';
  import ProposalCard from './ProposalCard.svelte';
  import Reasoning from './Reasoning.svelte';
  import TaskRow from './TaskRow.svelte';
  import ToolRow from './ToolRow.svelte';
  import TurnEnd from './TurnEnd.svelte';
  import UserMessage from './UserMessage.svelte';
  import UnknownRow from './UnknownRow.svelte';
  let {
    row,
    waiting,
    ended = false,
    last = false,
    reply,
  }: {
    row: HistoryRow;
    waiting: ReadonlySet<string>;
    ended?: boolean;
    last?: boolean;
    reply?: Extract<FeedRow, { type: 'agent' }> | string;
  } = $props();
</script>

{#if row.type === 'user'}
  {#if !row.hidden}<UserMessage {row} />{/if}
{:else if row.type === 'agent'}<AgentMessage {row} actions={!ended} />
{:else if row.type === 'question'}
  <!-- Pending questions belong to the pinned zone. -->
{:else if row.type === 'reasoning'}<Reasoning {row} />
{:else if row.type === 'explore'}<ExploreGroup {row} />
{:else if row.type === 'file'}<FileRow {row} waiting={row.items.some((i) => waiting.has(i.id))} />
{:else if row.type === 'command'}<CommandRow {row} waiting={waiting.has(row.id)} />
{:else if row.type === 'task'}<TaskRow {row} {waiting} />
{:else if row.type === 'tool'}<ToolRow {row} waiting={waiting.has(row.id)} />
{:else if row.type === 'image'}<ImageRow {row} />
{:else if row.type === 'notice'}<NoticeRow {row} {last} />
{:else if row.type === 'unknown'}<UnknownRow {row} />
{:else if row.type === 'turn_end'}
  <TurnEnd {row} {last} reply={typeof reply === 'string' ? reply : reply?.item.text} />
{:else if row.type === 'decision'}<DecisionRow {row} />
{:else if row.type === 'proposal'}
  {#if !isPendingProposal(row.item)}<ProposalCard {row} />{/if}
{:else if row.type === 'import_prep'}<ImportPrepRow {row} />{/if}
