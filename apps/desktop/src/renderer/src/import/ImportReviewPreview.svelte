<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ImportReviewState } from './import-review-state.svelte';
  import { blocks, sourceLabel } from './import-review-format';
  let { state }: { state: ImportReviewState } = $props();
  const current = $derived(state.current);
  const diff = $derived(state.diff);
</script>

<div class="preview">
  {#if current}
    <div class="pv-meta">
      {#if state.code(current)}<span class="pv-code">{state.code(current)}</span>{/if}
      <span class="mark" class:update={current.update}
        >{current.update ? t('import.review.update') : t('import.review.new')}</span
      >
    </div>
    <h2>{current.title}</h2>
    {#if diff}
      <div class="diff-card">
        <div class="diff-head">
          <Icon name="file" size={14} stroke={1.8} color="var(--sk-text-20)" />
          <span class="diff-title"
            >{t('import.review.updateOf', {
              name:
                current.type === 'brief'
                  ? 'brief.md'
                  : current.type === 'architecture'
                    ? 'architecture.md'
                    : current.type === 'adr'
                      ? `ADR-${current.title}`
                      : current.title,
            })}</span
          >
          <span class="stats"
            ><span class="add">+{diff.stats.added}</span><span class="del"
              >−{diff.stats.removed}</span
            ></span
          >
        </div>
        <div class="diff-lines">
          {#each diff.lines as line, i (i)}
            <span
              class:add={line.op === '+'}
              class:del={line.op === '-'}
              class:ctx={line.op === ' '}
              >{line.op === ' ' ? ' ' : line.op === '-' ? '−' : '+'} {line.text}</span
            >
          {/each}
        </div>
      </div>
    {:else if current.type === 'milestone' || current.type === 'task'}
      <div class="fields">
        {#each state.fields(current) as f (f.label)}
          <div class="field">
            <span class="sk-label">{f.label}</span>
            <span class="field-text">{f.text}</span>
          </div>
        {/each}
      </div>
    {:else}
      <div class="doc">
        {#each blocks(current.body) as b, i (i)}
          {#if b.kind === 'h'}<h3>{b.text}</h3>{:else if b.kind === 'li'}<div class="li">
              <span class="bullet"></span><span>{b.text}</span>
            </div>{:else}<p>{b.text}</p>{/if}
        {/each}
      </div>
    {/if}
    <div class="sources">
      <span class="sk-label">{t('import.review.sources')}</span>
      {#each current.sources as source (source)}
        {#if source === 'code'}
          <span class="source code">{sourceLabel(source)}</span>
        {:else}
          <button
            type="button"
            class="source"
            data-tip={t('import.review.openSource')}
            onclick={() =>
              void window.skaro.invoke('import.openSource', state.projectId, state.chatId, source)}
            >{source}</button
          >
        {/if}
      {/each}
    </div>
  {/if}
</div>
