<script lang="ts">
  import {
    actionGroupDiffStats,
    actionGroupSummary,
    dominantAction,
    actionGroupState,
    type ActionGroup,
    type ActionRow,
  } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import type { Snippet } from 'svelte';
  import './action-groups-i18n';
  import ActionIcon from './ActionIcon.svelte';
  import DiffBadge from './DiffBadge.svelte';

  let {
    group,
    waiting,
    children,
  }: {
    group: ActionGroup;
    waiting: ReadonlySet<string>;
    children: Snippet<[ActionRow]>;
  } = $props();

  let open = $state(false);
  const status = $derived(actionGroupState(group, waiting));
  const parts = $derived(actionGroupSummary(group));
  const kind = $derived(dominantAction(parts));
  const diff = $derived(actionGroupDiffStats(group));
  const caption = $derived(
    parts
      .map((part, i) => {
        const state = part.running
          ? 'running'
          : part.pending || !part.performed
            ? 'pending'
            : 'done';
        const text =
          t(`feed.group.${part.kind}.${state}`) +
          (part.progress ? ` ${part.progress.attempt}/${part.progress.max}` : '');
        return i ? text[0]!.toLocaleLowerCase() + text.slice(1) : text;
      })
      .join(' '),
  );
  const listId = $derived(`${group.id}-list`);
</script>

<div class="fd-block gap4" data-action-group={kind}>
  <button
    type="button"
    class="fd-fold fd-action-summary"
    aria-expanded={open}
    aria-controls={listId}
    onclick={() => (open = !open)}
  >
    <ActionIcon {kind} />
    <span>{caption}</span>
    {#if diff}<DiffBadge added={diff.added} removed={diff.removed} />{/if}
    {#if status.waiting}<span class="fd-wait-dot" title={t('feed.waiting')}></span>{/if}
    {#if status.running}<span class="fd-pulse"></span>{/if}
    {#if status.declined}<span class="fd-meta">{t('feed.cmd.declined')}</span>{/if}
    {#if status.interrupted}<span class="fd-meta">{t('feed.cmd.interrupted')}</span>{/if}
  </button>
  {#if open}
    <div class="fd-sublist" id={listId}>
      {#each group.rows as row (row.id)}{@render children(row)}{/each}
    </div>
  {/if}
</div>
