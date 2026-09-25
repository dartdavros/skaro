<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import { clock, useFeed } from './context.svelte';
  import { clock as formatClock, imageUrl, shortDuration } from './format';

  /**
   * "$ command ✓ 4с" with the description under it (Claude) and the output inside; live output and
   * exit codes where the agent gives them (Codex). Mockups 1a, 2a, 9e.
   */
  let { row, waiting = false }: { row: Extract<FeedRow, { type: 'command' }>; waiting?: boolean } =
    $props();

  const feed = useFeed();
  const item = $derived(row.item);
  let open = $state(false);
  let full = $state(false);

  const running = $derived(item.status === 'running');
  const background = $derived(item.background !== undefined);
  const output = $derived(item.output.replace(/\s+$/, ''));
  const tail = $derived.by(() => {
    if (full) return output;
    const lines = output.split('\n');
    return lines.length > 40 ? lines.slice(-40).join('\n') : output;
  });
  const truncated = $derived(!full && output.split('\n').length > 40);
  const elapsed = $derived(
    item.durationMs ?? (item.endedAt ?? (running ? clock.now : item.startedAt)) - item.startedAt,
  );
  const expandable = $derived(output.length > 0 || item.awaitingInput === true);

  const kind = $derived.by(() => {
    if (waiting || item.status === 'queued') return 'waiting';
    if (item.awaitingInput) return 'input';
    if (background) return 'background';
    if (running) return 'running';
    if (item.status === 'interrupted') return 'interrupted';
    if (item.status === 'declined') return 'declined';
    if (item.status === 'failed' || (item.exitCode !== undefined && item.exitCode !== 0))
      return 'failed';
    return 'ok';
  });

  const tip = $derived(
    kind === 'waiting'
      ? t('feed.waiting')
      : kind === 'input'
        ? t('feed.cmd.inputTip')
        : kind === 'background'
          ? t('feed.cmd.backgroundTip')
          : kind === 'running'
            ? item.outputLive
              ? t('feed.cmd.live')
              : t('feed.cmd.pending')
            : kind === 'interrupted'
              ? t('feed.cmd.interruptedTip')
              : kind === 'failed' && item.exitCode !== undefined
                ? t('feed.cmd.codeTip', { n: item.exitCode })
                : t('feed.cmd.tip'),
  );

  $effect(() => {
    if (item.awaitingInput) open = true;
  });
</script>

<div class="fd-block">
  <div
    class="fd-row-wrap"
    class:clickable={expandable}
    data-tip={tip}
    role="button"
    tabindex="0"
    onclick={() => expandable && (open = !open)}
    onkeydown={(e) => (e.key === 'Enter' || e.key === ' ') && expandable && (open = !open)}
  >
    <div class="fd-row">
      <span class="fd-glyph">$</span>
      <span class="fd-main">{item.command}</span>
      {#if kind === 'waiting'}
        <span class="fd-wait-dot"></span>
      {:else if kind === 'input'}
        <span class="fd-meta"
          ><span class="fd-wait-dot" style="margin: 0"></span>{t('feed.cmd.input')} · {formatClock(
            elapsed,
          )}</span
        >
      {:else if kind === 'background'}
        <span class="fd-meta">{t('feed.cmd.background')}</span>
      {:else if kind === 'running'}
        <span class="fd-meta"><span class="fd-pulse"></span>{formatClock(elapsed)}</span>
      {:else if kind === 'interrupted'}
        <span class="fd-meta">{t('feed.cmd.interrupted')}</span>
      {:else if kind === 'declined'}
        <span class="fd-meta">{t('feed.cmd.declined')}</span>
      {:else if kind === 'failed'}
        <span class="fd-meta bad"
          >{item.exitCode !== undefined ? t('feed.cmd.code', { n: item.exitCode }) : '✗'}</span
        >
      {:else}
        <span class="fd-meta ok">✓ {shortDuration(elapsed)}</span>
      {/if}
    </div>
    {#if item.description}<span class="fd-desc">{item.description}</span>{/if}
  </div>
  {#if open && expandable}
    <div class="fd-expanded">
      {#if output}
        <div class="fd-output" class:full>
          {tail}{#if running && item.outputLive}<span class="fd-cursor"></span>{/if}
        </div>
      {/if}
      {#if truncated || full}
        <button type="button" class="fd-link-btn" onclick={() => (full = !full)}
          >{full ? t('feed.cmd.showLess') : t('feed.cmd.showAll')}</button
        >
      {/if}
      {#if item.awaitingInput}
        <div class="input-note">
          <span>{t('feed.cmd.inputNote')}</span>
          {#if item.background}
            <button
              type="button"
              class="fd-btn"
              onclick={() => feed.stopBackground(item.background!.taskId)}
              >{t('feed.cmd.stop')}</button
            >
          {/if}
        </div>
      {/if}
      {#if item.image}
        <button
          type="button"
          class="fd-image-frame"
          data-tip={t('feed.image.open')}
          onclick={() => feed.viewImage(imageUrl(item.image!))}
        >
          <img src={imageUrl(item.image)} alt="" />
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .input-note {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 11.5px;
    line-height: 1.45;
    color: #7d7d7d;
  }

  .input-note span {
    flex: 1;
  }
</style>
