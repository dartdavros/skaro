<script lang="ts">
  import { diffExcerpt, diffStats, lineDiff, type FeedRow } from '@skaro/timeline';
  import { Button, Icon, Modal, TextField, t, tn } from '@skaro/ui';
  import type { ProposalAction } from '../../../shared/ipc';
  import { useFeed } from './context.svelte';
  import Markdown from './Markdown.svelte';

  /**
   * A chat agent's proposal (AgentChat mockup, agent-output.md 5.4): a document or a task change
   * with its diff, an ADR, a milestone with tasks. Decided plans and ADRs collapse into a line.
   */
  let { row }: { row: Extract<FeedRow, { type: 'proposal' }> } = $props();

  const feed = useFeed();
  const item = $derived(row.item);
  const proposal = $derived(item.proposal);
  const actionable = $derived(feed.interactive && feed.proposal !== undefined);

  let busy = $state(false);
  let viewer = $state(false);
  let editing = $state(false);
  let adrTitle = $state('');
  let adrBody = $state('');
  /** Plan: refs of the tasks the user keeps (all by default). */
  let skipped = $state<string[]>([]);

  /** Lines of the diff excerpt shown on the card; the rest opens in the viewer. */
  const MAX_LINES = 12;

  const diff = $derived.by(() => {
    if (proposal.type !== 'doc' && proposal.type !== 'task') return undefined;
    const lines = lineDiff(proposal.before ?? '', proposal.after);
    // Blank lines carry nothing on a card; the viewer shows the whole text.
    const excerpt = diffExcerpt(lines, 1)
      .map((l) =>
        'op' in l ? { gap: false, op: l.op, text: l.text } : { gap: true, op: ' ', text: '' },
      )
      .filter((l) => l.gap || l.text.trim() !== '');
    return {
      stats: diffStats(lines),
      lines: excerpt.slice(0, MAX_LINES),
      more: excerpt.length > MAX_LINES,
    };
  });

  const plan = $derived(proposal.type === 'plan' ? proposal : undefined);
  const chosen = $derived(plan ? plan.tasks.filter((t) => !skipped.includes(t.ref)) : []);

  async function decide(action: ProposalAction): Promise<void> {
    if (!feed.proposal || busy) return;
    busy = true;
    try {
      await feed.proposal(item.id, action);
    } catch {
      // The screen shows the error in its banner.
    } finally {
      busy = false;
    }
  }

  function toggle(ref: string): void {
    if (item.state !== 'pending' || !actionable) return;
    skipped = skipped.includes(ref) ? skipped.filter((r) => r !== ref) : [...skipped, ref];
  }

  function startEdit(): void {
    if (proposal.type !== 'adr') return;
    adrTitle = proposal.title;
    adrBody = proposal.body;
    editing = true;
  }

  function planTitle(): string {
    if (!plan) return '';
    const tasks = tn('proposal.tasks', plan.tasks.length);
    if (plan.milestone?.isNew)
      return t('proposal.plan.new', { id: plan.milestone.id, title: plan.milestone.title, tasks });
    if (plan.milestone)
      return t('proposal.plan.into', { id: plan.milestone.id, title: plan.milestone.title, tasks });
    return tasks;
  }

  function meta(task: { dependsOnTitles: string[] }): string {
    const deps = task.dependsOnTitles.length
      ? t('proposal.plan.meta.after', {
          list: task.dependsOnTitles.map((d) => `«${d}»`).join(', '),
        })
      : t('proposal.plan.meta.none');
    return plan?.milestone ? `${plan.milestone.id} · ${deps}` : deps;
  }

  /** The line a decided plan or ADR collapses into. */
  const summaryLine = $derived.by(
    ():
      { text: string; ok: boolean; open?: 'plan' | 'docs' | 'tasks'; tip?: string } | undefined => {
      if (item.state === 'pending') return undefined;
      if (proposal.type === 'plan') {
        if (item.state === 'rejected') {
          return {
            ok: false,
            text: proposal.milestone?.isNew
              ? t('proposal.rejected.plan', {
                  id: proposal.milestone.id,
                  title: proposal.milestone.title,
                })
              : t('proposal.rejected.tasks', {
                  tasks: tn('proposal.tasks', proposal.tasks.length),
                }),
          };
        }
        const created = item.result?.tasks?.length ?? 0;
        const milestone = item.result?.milestone;
        if (milestone) {
          return {
            ok: true,
            text: t('proposal.done.plan', {
              id: milestone.id,
              title: milestone.title,
              tasks: tn('proposal.tasks', created),
            }),
            open: 'plan',
            tip: t('proposal.open.plan.tip'),
          };
        }
        const text = tn('proposal.done.tasks', created);
        return {
          ok: true,
          text: proposal.milestone
            ? t('proposal.done.inMilestone', { text, id: proposal.milestone.id })
            : text,
          open: proposal.milestone ? 'plan' : 'tasks',
          tip: proposal.milestone ? t('proposal.open.plan.tip') : t('proposal.open.tasks.tip'),
        };
      }
      if (proposal.type === 'adr') {
        if (item.state === 'rejected') {
          return { ok: false, text: t('proposal.rejected.adr', { title: proposal.title }) };
        }
        const adr = item.result?.adr ?? { id: proposal.id, title: proposal.title };
        return {
          ok: true,
          text: t('proposal.done.adr', { id: adr.id, title: adr.title }),
          open: 'docs',
          tip: t('proposal.open.adr.tip'),
        };
      }
      return undefined;
    },
  );

  /** `code` spans in a short plain text (the ADR summary). */
  function segments(text: string): { code: boolean; text: string }[] {
    return text
      .split(/(`[^`]+`)/)
      .map((part) =>
        part.startsWith('`') && part.endsWith('`') && part.length > 2
          ? { code: true, text: part.slice(1, -1) }
          : { code: false, text: part },
      );
  }

  /** The ADR card text: the agent's summary, else the decision in short. */
  function adrText(p: { summary?: string; body: string }): string {
    if (p.summary) return p.summary;
    const plain = p.body
      .split('\n')
      .filter((l) => !/^#{1,6}\s/.test(l))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    return plain.length > 280 ? `${plain.slice(0, 279)}…` : plain;
  }
</script>

<div class="proposal" id="proposal-{item.id}">
  {#if summaryLine}
    <div class="line">
      <Icon
        name={summaryLine.ok ? 'check' : 'close'}
        size={13}
        stroke={2.4}
        color="var(--sk-text-20)"
      />
      <span class="line-text">{summaryLine.text}</span>
      {#if summaryLine.open && feed.openSection}
        {@const section = summaryLine.open}
        <button
          type="button"
          class="line-open"
          data-tip={summaryLine.tip}
          onclick={() => feed.openSection?.(section)}>{t('proposal.open')}</button
        >
      {/if}
    </div>
  {:else if (proposal.type === 'doc' || proposal.type === 'task') && diff}
    <div class="card flush">
      <div class="head">
        <Icon name="file" size={14} stroke={1.8} color="var(--sk-text-20)" />
        <span class="title"
          >{proposal.type === 'task'
            ? t('proposal.task.update', { id: proposal.id, title: proposal.title })
            : proposal.before === undefined
              ? t('proposal.doc.create', { path: proposal.path })
              : t('proposal.doc.update', { path: proposal.path })}</span
        >
        <span class="stats"
          ><span class="add">+{diff.stats.added}</span><span class="del">−{diff.stats.removed}</span
          ></span
        >
      </div>
      <div class="diff">
        {#each diff.lines as line, i (i)}
          {#if line.gap}
            <span class="ctx">⋯</span>
          {:else}
            <span
              class:add={line.op === '+'}
              class:del={line.op === '-'}
              class:ctx={line.op === ' '}>{line.op === ' ' ? ' ' : line.op} {line.text}</span
            >
          {/if}
        {/each}
        {#if diff.more}<span class="ctx">⋯</span>{/if}
      </div>
      <div class="foot">
        <span class="hint"
          >{item.state === 'pending'
            ? proposal.type === 'doc'
              ? t('proposal.hint.manual')
              : ''
            : t(`proposal.hint.${item.state}`)}</span
        >
        <button type="button" class="btn" onclick={() => (viewer = true)}
          >{t('proposal.open')}</button
        >
        {#if actionable && item.state === 'pending'}
          <button
            type="button"
            class="btn"
            disabled={busy}
            onclick={() => void decide({ action: 'reject' })}>{t('proposal.reject')}</button
          >
          <button
            type="button"
            class="btn primary"
            disabled={busy}
            onclick={() => void decide({ action: 'apply' })}>{t('proposal.apply')}</button
          >
        {:else if actionable && item.state === 'applied' && proposal.type === 'doc'}
          <button
            type="button"
            class="btn"
            disabled={busy}
            onclick={() => void decide({ action: 'revert' })}>{t('proposal.revert')}</button
          >
        {/if}
      </div>
    </div>
  {:else if proposal.type === 'adr'}
    <div class="card padded">
      <div class="head bare">
        <Icon name="adr" size={14} stroke={1.8} color="var(--sk-text-20)" />
        <span class="title">ADR-{proposal.id} · {proposal.title}</span>
      </div>
      <span class="text"
        >{#each segments(adrText(proposal)) as part, i (i)}{#if part.code}<code>{part.text}</code
            >{:else}{part.text}{/if}{/each}</span
      >
      {#if actionable}
        <div class="foot bare">
          <span class="hint"></span>
          <button
            type="button"
            class="btn"
            disabled={busy}
            onclick={() => void decide({ action: 'reject' })}>{t('proposal.reject')}</button
          >
          <button type="button" class="btn" disabled={busy} onclick={startEdit}
            >{t('proposal.edit')}</button
          >
          <button
            type="button"
            class="btn primary"
            disabled={busy}
            onclick={() => void decide({ action: 'apply' })}>{t('proposal.accept')}</button
          >
        </div>
      {/if}
    </div>
  {:else if plan}
    <div class="card flush">
      <div class="head plan-head">
        <Icon name="package" size={14} stroke={1.9} color="var(--sk-accent)" />
        <span class="title">{planTitle()}</span>
      </div>
      <div class="tasks">
        {#each plan.tasks as task (task.ref)}
          {@const on = !skipped.includes(task.ref)}
          <button
            type="button"
            class="task"
            class:static={!actionable}
            role="checkbox"
            aria-checked={on}
            onclick={() => toggle(task.ref)}
          >
            <span class="box" class:on>
              {#if on}<Icon name="check" size={11} stroke={3.2} color="var(--sk-text-3)" />{/if}
            </span>
            <span class="task-texts">
              <span class="task-title" class:on>{task.title}</span>
              <span class="task-meta">{meta(task)}</span>
            </span>
          </button>
        {/each}
      </div>
      {#if actionable}
        <div class="foot plan-foot">
          <span class="hint"
            >{chosen.length === 0
              ? t('proposal.plan.hint.none')
              : plan.milestone
                ? t('proposal.plan.hint', { id: plan.milestone.id })
                : t('proposal.plan.hint.loose')}</span
          >
          <button
            type="button"
            class="btn"
            disabled={busy}
            onclick={() => void decide({ action: 'reject' })}>{t('proposal.reject')}</button
          >
          <button
            type="button"
            class="btn primary"
            disabled={busy || chosen.length === 0}
            onclick={() => void decide({ action: 'apply', tasks: chosen.map((c) => c.ref) })}
            >{chosen.length === 0
              ? t('proposal.plan.pick')
              : chosen.length === plan.tasks.length
                ? t('proposal.plan.create', { tasks: tn('proposal.tasks', chosen.length) })
                : t('proposal.plan.createSome', { n: chosen.length })}</button
          >
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if proposal.type === 'doc' || proposal.type === 'task'}
  <Modal
    bind:open={viewer}
    width={760}
    title={proposal.type === 'doc' ? proposal.path : `${proposal.id} · ${proposal.title}`}
    subtitle={t('proposal.viewer.subtitle')}
  >
    <div class="viewer"><Markdown text={proposal.after} /></div>
  </Modal>
{/if}

{#if proposal.type === 'adr'}
  <Modal
    bind:open={editing}
    width={640}
    title={t('proposal.adr.edit')}
    subtitle={t('proposal.adr.edit.subtitle')}
  >
    <div class="edit">
      <TextField label={t('proposal.adr.title')} bind:value={adrTitle} />
      <label class="edit-body">
        <span class="sk-label">{t('proposal.adr.body')}</span>
        <textarea bind:value={adrBody} rows="14"></textarea>
      </label>
    </div>
    {#snippet footer()}
      <Button onclick={() => (editing = false)}>{t('proposal.cancel')}</Button>
      <Button
        variant="primary"
        disabled={busy || !adrTitle.trim() || !adrBody.trim()}
        onclick={() => {
          editing = false;
          void decide({ action: 'apply', adr: { title: adrTitle.trim(), body: adrBody } });
        }}>{t('proposal.accept')}</Button
      >
    {/snippet}
  </Modal>
{/if}

<style>
  .proposal {
    flex: none;
    display: flex;
    flex-direction: column;
    scroll-margin: 40px;
  }

  .card {
    border-radius: 10px;
    background: var(--sk-fill-17);
    display: flex;
    flex-direction: column;
  }

  .card.flush {
    overflow: hidden;
  }

  .card.padded {
    padding: 11px 13px;
    gap: 9px;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 11px 13px 9px;
  }

  .head.bare {
    padding: 0;
  }

  .head.plan-head {
    padding: 11px 13px 4px;
  }

  .title {
    flex: 1;
    min-width: 0;
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

  .diff {
    min-width: 0;
    padding: 0 13px 10px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    line-height: 1.4;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .foot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 13px 12px;
  }

  .foot.bare {
    padding: 0;
  }

  .foot.plan-foot {
    padding: 10px 13px 12px;
  }

  .hint {
    flex: 1;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .btn {
    flex: none;
    height: 28px;
    padding: 0 11px;
    border: none;
    border-radius: 7px;
    background: var(--sk-fill-23);
    color: var(--sk-text-10);
    font: inherit;
    font-size: var(--sk-fs-4);
    font-weight: 600;
    cursor: pointer;
  }

  .btn:hover:not(:disabled) {
    background: var(--sk-fill-29);
    color: var(--sk-text-2);
  }

  .btn.primary {
    padding: 0 12px;
    background: var(--sk-accent);
    color: var(--sk-text-1);
    font-weight: 700;
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--sk-accent-hover);
    color: var(--sk-text-1);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .text {
    font-size: var(--sk-fs-5);
    line-height: 1.45;
    color: var(--sk-text-13);
    text-wrap: pretty;
  }

  .text code {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-code);
  }

  .tasks {
    padding: 0 13px;
    display: flex;
    flex-direction: column;
  }

  .task {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 0;
    border: none;
    background: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .task.static {
    cursor: default;
  }

  .box {
    flex: none;
    margin-top: 2px;
    width: 16px;
    height: 16px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 5px;
    background: var(--sk-fill-11);
    box-shadow: inset 0 0 0 1px var(--sk-fill-30);
    transition:
      background 0.12s,
      box-shadow 0.12s;
  }

  .box.on {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-fill-37);
  }

  .task-texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .task-title {
    font-size: var(--sk-fs-5);
    font-weight: 600;
    color: var(--sk-text-19);
  }

  .task-title.on {
    color: var(--sk-text-6);
  }

  .task-meta {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .line {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 6px 2px;
  }

  .line-text {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-4);
    color: var(--sk-text-19);
  }

  .line-open {
    flex: none;
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: var(--sk-fs-3);
    font-weight: 600;
    color: var(--sk-text-13);
    cursor: pointer;
  }

  .line-open:hover {
    color: var(--sk-text-2);
  }

  .viewer {
    max-height: calc(100vh - 220px);
    overflow-y: auto;
    margin: 0 -4px;
    padding: 0 4px;
  }

  .edit {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .edit-body {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  textarea {
    width: 100%;
    min-height: 240px;
    max-height: calc(100vh - 360px);
    padding: 9px 11px;
    border: none;
    border-radius: 8px;
    background: var(--sk-fill-3);
    box-shadow: inset 0 0 0 1px var(--sk-fill-25);
    color: var(--sk-text-2);
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-5);
    font-weight: 400;
    line-height: 1.45;
    resize: vertical;
    outline: none;
  }

  textarea:focus {
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }
</style>
