<script lang="ts">
  import { diffExcerpt, diffStats, lineDiff } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import type { ImportReview, ImportReviewItem } from '../../../shared/ipc';
  import './i18n';

  /**
   * "Проверка импорта" (ImportReview mockup): what the import agent staged, by section, with a
   * checkbox each; the picked artifact on the right; what was not carried over below.
   */
  let {
    projectId,
    chatId,
    onclose,
    onapply,
  }: {
    projectId: string;
    chatId: string;
    onclose: () => void;
    /** Writes the picked artifacts; rejects with the reason. */
    onapply: (keys: string[]) => Promise<void>;
  } = $props();

  let review = $state<ImportReview | undefined>();
  let off = $state<Record<string, boolean>>({});
  let selected = $state<string | undefined>();
  let skippedOpen = $state(false);
  let notesOpen = $state(false);
  let applying = $state(false);
  let progress = $state({ done: 0, total: 0 });
  let error = $state<string | undefined>();
  /** The error is "this file changed on disk": `error` holds its path. */
  let errorIsFile = $state(false);

  // svelte-ignore state_referenced_locally
  void window.skaro.invoke('import.review', projectId, chatId).then((r) => {
    review = r;
    selected = r.items.find((i) => i.type === 'architecture')?.key ?? r.items[0]?.key;
  });

  const stop = window.skaro.on('import.progress', (p) => {
    if (p.chatId === chatId) progress = { done: p.done, total: p.total };
  });
  onDestroy(stop);

  const items = $derived(review?.items ?? []);
  const byKey = $derived(new Map(items.map((i) => [i.key, i])));
  const on = (key: string) => !off[key];
  const picked = $derived(items.filter((i) => on(i.key)));
  const current = $derived(items.find((i) => i.key === selected));

  const GROUPS = [
    ['adr', 'import.review.adr'],
    ['spec', 'import.review.specs'],
    ['doc', 'import.review.docs'],
  ] as const;
  const core = $derived(items.filter((i) => i.type === 'brief' || i.type === 'architecture'));
  const milestones = $derived(items.filter((i) => i.type === 'milestone'));
  const tasks = $derived(items.filter((i) => i.type === 'task'));
  const planItems = $derived([...milestones, ...tasks]);
  /** Tasks under a staged milestone; the rest ("Без этапа") after the milestones. */
  const tasksOf = (key: string) => tasks.filter((x) => x.milestone === key);
  const loose = $derived(
    tasks.filter((x) => !x.milestone || byKey.get(x.milestone)?.type !== 'milestone'),
  );

  function set(keys: string[], value: boolean): void {
    const next = { ...off };
    for (const k of keys) {
      if (value) delete next[k];
      else next[k] = true;
    }
    off = next;
  }

  /** Unticking a milestone unticks its tasks; ticking it ticks only the milestone. */
  function toggle(item: ImportReviewItem): void {
    const value = !on(item.key);
    const kids = item.type === 'milestone' && !value ? tasksOf(item.key).map((x) => x.key) : [];
    set([item.key, ...kids], value);
  }

  function toggleGroup(list: ImportReviewItem[]): void {
    const all = list.every((i) => on(i.key));
    set(
      list.map((i) => i.key),
      !all,
    );
  }

  /** A ticked artifact that links to an unticked one: the link is left out when applied. */
  function dangling(item: ImportReviewItem): boolean {
    return on(item.key) && item.refs.some((r) => !on(r));
  }

  function sourceLabel(source: string): string {
    return source === 'code' ? t('import.review.code') : source;
  }

  function code(item: ImportReviewItem): string {
    if (item.type === 'adr') return t('import.review.adrCode');
    if (item.type === 'spec') return t('import.review.specCode');
    if (item.type === 'milestone') return review?.milestones[item.key] ?? '';
    return '';
  }

  /** The body as the mockup shows it: headings, paragraphs, list items. */
  function blocks(body: string): { kind: 'h' | 'p' | 'li'; text: string }[] {
    const out: { kind: 'h' | 'p' | 'li'; text: string }[] = [];
    let para: string[] = [];
    const flush = () => {
      if (para.length) out.push({ kind: 'p', text: para.join(' ') });
      para = [];
    };
    for (const raw of body.split('\n')) {
      const line = raw.trim();
      const h = /^#{1,6}\s+(.+)$/.exec(line);
      const li = /^(?:[-*+]|\d+\.)\s+(?:\[[ xX]\]\s+)?(.+)$/.exec(line);
      if (h) {
        flush();
        out.push({ kind: 'h', text: h[1]! });
      } else if (li) {
        flush();
        out.push({ kind: 'li', text: li[1]! });
      } else if (!line) flush();
      else para.push(line.replace(/\*\*|__|`/g, ''));
    }
    flush();
    return out;
  }

  const diff = $derived.by(() => {
    if (!current?.update || current.before === undefined) return undefined;
    const lines = lineDiff(current.before, current.body);
    return {
      stats: diffStats(lines),
      lines: diffExcerpt(lines, 1)
        .map((l) => ('op' in l ? { op: l.op, text: l.text } : { op: ' ', text: '⋯' }))
        .filter((l) => l.text.trim() !== ''),
    };
  });

  function fields(item: ImportReviewItem): { label: string; text: string }[] {
    const f = item.fields ?? {};
    if (item.type === 'milestone') {
      return [
        { label: t('import.review.goal'), text: f.goal ?? '' },
        { label: t('import.review.doneWhen'), text: f.doneWhen ?? '' },
      ];
    }
    const deps = item.dependsOn
      .map((d) => byKey.get(d)?.title ?? d)
      .map((title) => `«${title}»`)
      .join(', ');
    return [
      { label: t('import.review.goal'), text: f.goal ?? '' },
      { label: t('import.review.criteria'), text: (f.criteria ?? []).join(' · ') },
      {
        label: t('import.review.deps'),
        text: deps ? t('import.review.after', { list: deps }) : t('import.review.none'),
      },
    ];
  }

  async function apply(): Promise<void> {
    if (!picked.length || applying) return;
    applying = true;
    error = undefined;
    progress = { done: 0, total: picked.length };
    try {
      await onapply(picked.map((i) => i.key));
      onclose();
    } catch (e) {
      const text = (e instanceof Error ? e.message : String(e)).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        '',
      );
      const path = /changed-on-disk:(.+)$/.exec(text)?.[1];
      error = path ?? text;
      errorIsFile = path !== undefined;
    } finally {
      applying = false;
    }
  }
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && !applying && onclose()} />

<div class="backdrop" role="presentation" onclick={() => !applying && onclose()}>
  <div
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-label={t('import.review.title')}
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={() => undefined}
  >
    <div class="head">
      <div class="titles">
        <span class="title">{t('import.review.title')}</span>
        <span class="subtitle">{t('import.review.subtitle')}</span>
      </div>
      <button
        type="button"
        class="x"
        data-tip={t('ui.closeEsc')}
        aria-label={t('ui.close')}
        onclick={onclose}><Icon name="close" size={14} stroke={2.2} /></button
      >
    </div>

    {#if error}
      <div class="alert" role="alert">
        <Icon name="errorCircle" size={16} stroke={1.9} />
        <span class="alert-text"
          ><strong>{t('import.review.failed')}</strong>
          {#if errorIsFile}{t('import.review.changed.before')}<span class="mono">{error}</span>{t(
              'import.review.changed.after',
            )}{:else}{error}{/if}</span
        >
        <button type="button" class="retry" onclick={() => void apply()}
          >{t('import.review.retry')}</button
        >
      </div>
    {/if}

    <div class="main">
      <div class="list">
        <div class="rows">
          {#snippet row(item: ImportReviewItem, indent: boolean)}
            {@const checked = on(item.key)}
            <div
              class="row"
              class:on={selected === item.key}
              role="button"
              tabindex="0"
              style="padding-left: {indent ? 36 : 10}px"
              onclick={() => (selected = item.key)}
              onkeydown={(e) => e.key === 'Enter' && (selected = item.key)}
            >
              <span
                class="box"
                class:checked
                role="checkbox"
                aria-checked={checked}
                tabindex="0"
                onclick={(e) => {
                  e.stopPropagation();
                  toggle(item);
                }}
                onkeydown={(e) => e.key === ' ' && toggle(item)}
                >{#if checked}<Icon
                    name="check"
                    size={11}
                    stroke={3.2}
                    color="var(--sk-text-3)"
                  />{/if}</span
              >
              {#if item.type === 'milestone'}<span class="ms">{code(item)}</span>{/if}
              <span class="row-title" class:off={!checked}>{item.title}</span>
              {#if dangling(item)}<span class="dangling" data-tip={t('import.review.dangling')}
                ></span>{/if}
              <span class="mark" class:update={item.update}
                >{item.update ? t('import.review.update') : t('import.review.new')}</span
              >
              <span class="src" data-tip={item.sources.map(sourceLabel).join('\n')}
                >{item.sources.length}</span
              >
            </div>
          {/snippet}
          {#snippet group(label: string, list: ImportReviewItem[])}
            {@const n = list.filter((i) => on(i.key)).length}
            <div class="group">
              <span
                class="box"
                class:checked={n === list.length}
                class:part={n > 0 && n < list.length}
                role="checkbox"
                aria-checked={n === list.length ? true : n ? 'mixed' : false}
                tabindex="0"
                data-tip={n === list.length ? t('import.review.none.all') : t('import.review.all')}
                onclick={() => toggleGroup(list)}
                onkeydown={(e) => e.key === ' ' && toggleGroup(list)}
                >{#if n === list.length}<Icon
                    name="check"
                    size={11}
                    stroke={3.2}
                    color="var(--sk-text-3)"
                  />{:else if n}<span class="dash"></span>{/if}</span
              >
              <span class="group-label">{label}</span>
              <span class="group-count">{t('import.review.count', { n, of: list.length })}</span>
            </div>
          {/snippet}

          {#each core as item (item.key)}{@render row(item, false)}{/each}
          {#each GROUPS as [type, label] (type)}
            {@const list = items.filter((i) => i.type === type)}
            {#if list.length}
              {@render group(t(label), list)}
              {#each list as item (item.key)}{@render row(item, false)}{/each}
            {/if}
          {/each}
          {#if planItems.length}
            {@render group(t('import.review.plan'), planItems)}
            {#each milestones as m (m.key)}
              {@render row(m, false)}
              {#each tasksOf(m.key) as task (task.key)}{@render row(task, true)}{/each}
            {/each}
            {#if loose.length}
              <div class="sub">{t('import.review.loose')}</div>
              {#each loose as task (task.key)}{@render row(task, true)}{/each}
            {/if}
          {/if}

          <div class="sep"></div>
          {#if review?.skipped.length}
            <button type="button" class="fold" onclick={() => (skippedOpen = !skippedOpen)}>
              <span class="chev" class:open={skippedOpen}
                ><Icon name="chevronRight" size={12} stroke={2.4} /></span
              >
              {t('import.review.skipped')}&nbsp;·&nbsp;<span class="mono"
                >{review.skipped.length}</span
              >
            </button>
            {#if skippedOpen}
              <div class="skipped">
                {#each review.skipped as s, i (i)}
                  <div class="skipped-row">
                    <span class="skipped-path">{s.path}</span>
                    <span class="skipped-why">{s.reason}</span>
                  </div>
                {/each}
              </div>
            {/if}
          {/if}
          {#if review?.notes.length}
            <button type="button" class="fold" onclick={() => (notesOpen = !notesOpen)}>
              <span class="chev" class:open={notesOpen}
                ><Icon name="chevronRight" size={12} stroke={2.4} /></span
              >
              {t('import.review.notes')}&nbsp;·&nbsp;<span class="mono">{review.notes.length}</span>
            </button>
            {#if notesOpen}
              <div class="notes">
                {#each review.notes as note, i (i)}<span>{note}</span>{/each}
              </div>
            {/if}
          {/if}
        </div>
      </div>

      <div class="preview">
        {#if current}
          <div class="pv-meta">
            {#if code(current)}<span class="pv-code">{code(current)}</span>{/if}
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
              {#each fields(current) as f (f.label)}
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
                    void window.skaro.invoke('import.openSource', projectId, chatId, source)}
                  >{source}</button
                >
              {/if}
            {/each}
          </div>
        {/if}
      </div>
    </div>

    <div class="foot">
      <span class="picked"
        >{t('import.review.picked.before')}<span class="mono">{picked.length}</span>{t(
          'import.review.picked.middle',
        )}<span class="mono">{items.length}</span></span
      >
      <button type="button" class="cancel" disabled={applying} onclick={onclose}
        >{t('ui.cancel')}</button
      >
      {#if applying}
        <button type="button" class="applying" data-tip={t('import.review.applying.tip')}>
          <span
            class="bar"
            style="width: {progress.total
              ? Math.round((progress.done / progress.total) * 100)
              : 0}%"
          ></span>
          <span class="bar-text"
            >{t('import.review.applying', { n: progress.done, of: progress.total })}</span
          >
        </button>
      {:else}
        <button
          type="button"
          class="apply"
          class:ok={picked.length > 0}
          disabled={!picked.length}
          data-tip={picked.length ? undefined : t('import.review.nothing')}
          onclick={() => void apply()}>{t('import.review.apply')}</button
        >
      {/if}
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: var(--sk-black-a55);
    backdrop-filter: blur(3px);
  }

  .dialog {
    position: relative;
    width: 1040px;
    height: 660px;
    max-width: 100%;
    max-height: 100%;
    display: flex;
    flex-direction: column;
    border-radius: var(--sk-radius-modal);
    background: var(--sk-modal);
    box-shadow:
      0 30px 80px var(--sk-black-a60),
      0 0 0 1px rgba(255, 255, 255, 0.04);
    color: var(--sk-text-body);
    overflow: hidden;
    outline: none;
  }

  .head {
    flex: none;
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--sk-fill-18);
  }

  .titles {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .title {
    font-size: var(--sk-fs-12);
    font-weight: 700;
    color: var(--sk-text-5);
  }

  .subtitle {
    font-size: var(--sk-fs-6);
    color: var(--sk-text-17);
  }

  .x {
    flex: none;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-21);
    cursor: pointer;
  }

  .x:hover {
    background: var(--sk-fill-20);
    color: var(--sk-text-2);
  }

  .alert {
    flex: none;
    margin: 12px 20px 0;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 11px 12px 11px 14px;
    border-radius: 9px;
    background: var(--sk-error-a10);
    color: var(--sk-error);
  }

  .alert-text {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-6);
  }

  .alert-text strong {
    font-weight: 600;
  }

  .retry {
    flex: none;
    padding: 0;
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: var(--sk-fs-6);
    font-weight: 600;
    cursor: pointer;
  }

  .retry:hover {
    text-decoration: underline;
  }

  .mono {
    font-family: var(--sk-mono);
  }

  .alert .mono {
    font-size: var(--sk-fs-4);
  }

  .main {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .list {
    flex: none;
    width: 400px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-right: 1px solid var(--sk-fill-18);
  }

  .rows {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 10px 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 10px;
    height: 32px;
    margin-top: 10px;
    padding: 0 10px;
  }

  .group-label {
    flex: 1;
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--sk-text-23);
  }

  .group-count {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-23);
  }

  .sub {
    display: flex;
    align-items: center;
    height: 28px;
    margin-top: 4px;
    padding: 0 10px 0 36px;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-23);
  }

  .row {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 34px;
    padding: 4px 10px;
    border-radius: 8px;
    cursor: pointer;
    outline: none;
  }

  .row:hover {
    background: var(--sk-fill-17);
  }

  .row.on {
    background: var(--sk-fill-20);
  }

  .box {
    flex: none;
    width: 16px;
    height: 16px;
    border-radius: 5px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: var(--sk-fill-11);
    box-shadow: inset 0 0 0 1px var(--sk-fill-30);
    cursor: pointer;
    outline: none;
  }

  .box.checked {
    background: var(--sk-fill-2);
    box-shadow: inset 0 0 0 1px var(--sk-fill-37);
  }

  .box.part {
    box-shadow: inset 0 0 0 1px var(--sk-fill-37);
  }

  .dash {
    width: 8px;
    height: 2px;
    border-radius: 1px;
    background: var(--sk-text-7);
  }

  .ms {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-17);
  }

  .row-title {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-6);
    color: var(--sk-text-6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-title.off {
    color: var(--sk-text-21);
  }

  .dangling {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--sk-warn);
  }

  .mark {
    flex: none;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .mark.update {
    color: var(--sk-link);
  }

  .src {
    flex: none;
    min-width: 16px;
    text-align: right;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-23);
    cursor: default;
    white-space: pre-line;
  }

  .sep {
    height: 1px;
    margin: 12px 10px 6px;
    background: var(--sk-fill-18);
  }

  .fold {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 30px;
    padding: 0 10px;
    border: none;
    border-radius: 7px;
    background: transparent;
    font: inherit;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-19);
    text-align: left;
    cursor: pointer;
  }

  .fold:hover {
    background: var(--sk-fill-17);
    color: var(--sk-text-6);
  }

  .chev {
    display: inline-flex;
    transition: transform 0.15s;
  }

  .chev.open {
    transform: rotate(90deg);
  }

  .skipped {
    display: flex;
    flex-direction: column;
    padding: 0 10px 6px 30px;
  }

  .skipped-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 4px 0;
  }

  .skipped-path {
    flex: 1;
    min-width: 0;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-13);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .skipped-why {
    flex: none;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-23);
  }

  .notes {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 2px 10px 6px 30px;
    font-size: var(--sk-fs-4);
    line-height: 1.5;
    color: var(--sk-text-13);
    text-wrap: pretty;
  }

  .preview {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow-y: auto;
    padding: 22px 26px 24px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .pv-meta {
    display: flex;
    align-items: baseline;
    gap: 10px;
  }

  .pv-code {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    font-weight: 600;
    color: var(--sk-text-19);
  }

  h2 {
    margin: -8px 0 0;
    font-size: var(--sk-fs-14);
    font-weight: 700;
    color: var(--sk-text-5);
    letter-spacing: -0.01em;
  }

  .diff-card {
    border-radius: 10px;
    background: var(--sk-fill-17);
    overflow: hidden;
  }

  .diff-head {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 11px 13px 9px;
  }

  .diff-title {
    flex: 1;
    font-size: var(--sk-fs-5);
    font-weight: 600;
    color: var(--sk-text-6);
  }

  .stats {
    display: inline-flex;
    gap: 6px;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
  }

  .add {
    color: var(--sk-green-2);
  }

  .del {
    color: var(--sk-error);
  }

  .ctx {
    color: var(--sk-text-23);
  }

  .diff-lines {
    padding: 0 13px 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .doc {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .doc h3 {
    margin: 6px 0 0;
    font-size: var(--sk-fs-10);
    font-weight: 700;
    color: var(--sk-text-6);
  }

  .doc p {
    margin: 0;
    font-size: var(--sk-fs-7);
    line-height: 1.65;
    color: var(--sk-text-10);
    text-wrap: pretty;
  }

  .li {
    display: flex;
    gap: 10px;
    font-size: var(--sk-fs-7);
    line-height: 1.6;
    color: var(--sk-text-10);
  }

  .bullet {
    flex: none;
    width: 5px;
    height: 5px;
    margin-top: 9px;
    border-radius: 50%;
    background: var(--sk-text-27);
  }

  .fields {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .field-text {
    font-size: var(--sk-fs-7);
    line-height: 1.6;
    color: var(--sk-text-10);
    text-wrap: pretty;
  }

  .sources {
    margin-top: auto;
    padding-top: 12px;
    border-top: 1px solid var(--sk-fill-18);
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .source {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    color: var(--sk-link);
    text-align: left;
    cursor: pointer;
  }

  .source:hover {
    text-decoration: underline;
  }

  .source.code {
    color: var(--sk-text-13);
    cursor: default;
  }

  .source.code:hover {
    text-decoration: none;
  }

  .foot {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 20px;
    border-top: 1px solid var(--sk-fill-18);
  }

  .picked {
    flex: 1;
    font-size: var(--sk-fs-6);
    color: var(--sk-text-13);
  }

  .cancel,
  .apply,
  .applying {
    height: 34px;
    border: none;
    border-radius: 8px;
    font: inherit;
    font-size: var(--sk-fs-6);
  }

  .cancel {
    padding: 0 14px;
    background: var(--sk-fill-20);
    color: var(--sk-text-6);
    font-weight: 600;
    cursor: pointer;
  }

  .cancel:hover {
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }

  .apply {
    padding: 0 15px;
    background: var(--sk-fill-20);
    color: var(--sk-text-25);
    font-weight: 700;
    cursor: default;
  }

  .apply.ok {
    background: var(--sk-accent);
    color: var(--sk-text-1);
    cursor: pointer;
  }

  .apply.ok:hover {
    background: var(--sk-accent-hover);
  }

  .applying {
    position: relative;
    min-width: 196px;
    padding: 0 15px;
    background: var(--sk-fill-20);
    color: var(--sk-text-13);
    font-weight: 700;
    cursor: default;
    overflow: hidden;
  }

  .bar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    background: var(--sk-fill-29);
    transition: width 0.5s;
  }

  .bar-text {
    position: relative;
  }
</style>
