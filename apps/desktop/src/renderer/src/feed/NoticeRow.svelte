<script lang="ts" module>
  function firstLine(text: string): string {
    return text.split('\n')[0] ?? '';
  }
</script>

<script lang="ts">
  import { reconnectionProgress, type FeedRow } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import { clock, useFeed } from './context.svelte';
  import ActionIcon from './ActionIcon.svelte';
  import './action-groups-i18n';
  import MergedNotice from './MergedNotice.svelte';

  /** Service lines: retry, compaction, model switch, MCP failure, session restore, merge. */
  let { row, last }: { row: Extract<FeedRow, { type: 'notice' }>; last: boolean } = $props();

  const feed = useFeed();
  const item = $derived(row.item);
  let details = $state(false);
  const reconnect = $derived(reconnectionProgress(item));

  const retryIn = $derived(
    item.retry ? Math.max(0, Math.ceil((item.startedAt + item.retry.inMs - clock.now) / 1000)) : 0,
  );
</script>

{#if item.code === 'retry'}
  <div class="fd-live" data-tip={item.text || t('feed.notice.retry.tip')}>
    <ActionIcon kind="reconnect" />
    <span
      >{t('feed.group.reconnect.done')}{#if reconnect}
        {reconnect.attempt}/{reconnect.max}{/if}</span
    >
    {#if last && item.retry}<span
        >{t('feed.notice.retry', {
          a: item.retry.attempt,
          b: item.retry.max,
          s: retryIn,
        })}</span
      >{/if}
  </div>
{:else if item.code === 'compaction'}
  <div class="fd-divider" data-tip={t('feed.notice.compaction.tip')}>
    <span>{t('feed.notice.compaction')}</span>
  </div>
{:else if item.code === 'session_restored'}
  <div class="fd-live" data-tip={t('feed.notice.restored.tip')}>
    <ActionIcon kind="reconnect" />
    <span>{t('feed.notice.restored')}</span>
  </div>
{:else if item.code === 'merged'}
  <MergedNotice {row} />
{:else if item.code === 'session_lost'}
  <div class="fd-bar warning">
    <Icon name="warning" size={13} stroke={2.2} color="var(--sk-warn)" />
    <span class="text">{t('feed.notice.lost')}</span>
    {#if feed.interactive}
      <button type="button" class="action" onclick={() => feed.restart()}
        >{t('feed.end.restart')}</button
      >
    {/if}
  </div>
{:else if item.code === 'model_switched'}
  <div class="fd-notice" data-tip={t('feed.notice.model.tip')}>
    <Icon name="swap" size={12} stroke={2} />
    <span>{item.text || t('feed.notice.model')}</span>
  </div>
{:else}
  <div class="fd-notice {item.level}">
    <Icon name={item.level === 'info' ? 'info' : 'warning'} size={12} stroke={2} />
    <span>
      {item.code === 'denied' && !item.text
        ? t('feed.notice.denied')
        : details
          ? item.text
          : firstLine(item.text)}
      {#if !details && item.text.includes('\n')}
        <button type="button" class="more" onclick={() => (details = true)}
          >{t('feed.notice.more')}</button
        >
      {/if}
    </span>
  </div>
{/if}

<style>
  .more {
    margin-left: 6px;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }

  .more:hover {
    text-decoration: underline;
  }

  span {
    white-space: pre-wrap;
  }
</style>
