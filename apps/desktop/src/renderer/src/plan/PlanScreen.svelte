<script lang="ts">
  import { Checkbox, Icon, t, tn } from '@skaro/ui';
  import type { MilestoneInfo, MilestoneInput } from '../../../shared/ipc';
  import type { ProjectTasks } from '../tasks/data.svelte';
  import DeleteStage from './DeleteStage.svelte';
  import './i18n';
  import { heirOf, relations, stages, type Drag, type Over } from './model';
  import StageCard from './StageCard.svelte';
  import StageModal from './StageModal.svelte';

  /** "План" (Plan mockup): milestones in order, their tasks, drag and drop, milestone editing. */
  let {
    projectId,
    data,
    onopen,
    onchat,
  }: {
    projectId: string;
    data: ProjectTasks;
    onopen: (taskId: string) => void;
    /** A new chat with the agent (replanning, a new task, discussing a milestone). */
    onchat: () => void;
  } = $props();

  let hideDone = $state(false);
  let openMap = $state<Record<string, boolean> | undefined>();
  let hovered = $state<string | undefined>();
  let drag = $state<Drag | undefined>();
  let over = $state<Over | undefined>();
  let modal = $state<{ kind: 'new' } | { kind: 'edit' | 'delete'; milestone: MilestoneInfo }>();
  let now = $state(Date.now());

  const list = $derived(stages(data.milestones, data.tasks));
  const byId = $derived(new Map(data.tasks.map((x) => [x.id, x])));
  const rel = $derived(relations(hovered ? byId.get(hovered) : undefined, data.tasks));
  const anyOpen = $derived(list.some((s) => openMap?.[s.milestone.id]));
  const done = $derived(list.reduce((n, s) => n + s.done, 0));
  const total = $derived(list.reduce((n, s) => n + s.total, 0));

  // At first the milestones still in work are open.
  $effect(() => {
    if (openMap || !data.loaded) return;
    openMap = Object.fromEntries(
      list.map((s) => [s.milestone.id, s.total === 0 || s.done < s.total]),
    );
  });

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  function toggle(id: string): void {
    openMap = { ...openMap, [id]: !openMap?.[id] };
  }

  function drop(): void {
    const d = drag;
    const o = over;
    drag = undefined;
    over = undefined;
    if (!d || !o) return;
    if (d.kind === 'stage' && o.kind === 'stage') {
      const ids = list.map((s) => s.milestone.id);
      const from = ids.indexOf(d.id);
      ids.splice(from, 1);
      ids.splice(from < o.index ? o.index - 1 : o.index, 0, d.id);
      void window.skaro.invoke('plan.reorder', projectId, ids);
    }
    if (d.kind === 'task' && o.kind === 'task') {
      const from = list.find((s) => s.tasks.some((x) => x.id === d.id));
      const old = from?.tasks.findIndex((x) => x.id === d.id) ?? -1;
      const index = from?.milestone.id === o.stage && old < o.index ? o.index - 1 : o.index;
      openMap = { ...openMap, [o.stage]: true };
      void window.skaro.invoke('plan.placeTask', projectId, d.id, o.stage, index);
    }
  }

  async function save(input: MilestoneInput): Promise<void> {
    const m = modal;
    modal = undefined;
    if (m?.kind === 'edit')
      await window.skaro.invoke('plan.update', projectId, m.milestone.id, input);
    else {
      const created = await window.skaro.invoke('plan.create', projectId, input);
      openMap = { ...openMap, [created.id]: true };
    }
  }

  async function remove(milestone: MilestoneInfo): Promise<void> {
    modal = undefined;
    await window.skaro.invoke('plan.delete', projectId, milestone.id);
  }
</script>

<div class="screen">
  <div class="top">
    <div class="titles">
      <div>
        <h1>{t('plan.title')}</h1>
        {#if list.length}
          <div class="sub">
            {t('plan.sub', { stages: tn('plan.stages', list.length), done, total })}
          </div>
        {/if}
      </div>
      <div class="actions">
        <button type="button" class="secondary" data-tip={t('plan.replan.tip')} onclick={onchat}
          ><Icon name="chat" size={14} stroke={1.9} />{t('plan.replan')}</button
        >
        <button type="button" class="primary" onclick={() => (modal = { kind: 'new' })}
          ><Icon name="plus" size={14} stroke={2.6} />{t('plan.new')}</button
        >
      </div>
    </div>
    {#if list.length}
      <div class="tools">
        <div
          class="hide"
          role="checkbox"
          aria-checked={hideDone}
          tabindex="0"
          data-tip={t('plan.hideDone.tip')}
          onclick={() => (hideDone = !hideDone)}
          onkeydown={(e) => e.key === 'Enter' && (hideDone = !hideDone)}
        >
          <span class="box"><Checkbox checked={hideDone} /></span>{t('plan.hideDone')}
        </div>
        <div class="spacer"></div>
        <button
          type="button"
          class="all"
          data-tip={anyOpen ? t('plan.collapseAll') : t('plan.expandAll')}
          onclick={() =>
            (openMap = anyOpen ? {} : Object.fromEntries(list.map((s) => [s.milestone.id, true])))}
          ><Icon name={anyOpen ? 'collapseAll' : 'expandAll'} size={16} stroke={1.9} /></button
        >
      </div>
    {/if}
  </div>

  {#if data.loaded && !list.length}
    <div class="empty">
      <span class="empty-icon"><Icon name="plan" size={30} stroke={1.5} /></span>
      <div class="empty-copy">
        <span class="empty-title">{t('plan.empty.title')}</span>
        <span class="empty-text">{t('plan.empty.text')}</span>
      </div>
      <button type="button" class="primary big" onclick={onchat}
        ><Icon name="chat" size={14} stroke={2} />{t('plan.discuss')}</button
      >
    </div>
  {:else}
    <div class="stages" role="list">
      {#each list as stage, index (stage.milestone.id)}
        <StageCard
          {stage}
          {index}
          open={!!openMap?.[stage.milestone.id]}
          {hideDone}
          {hovered}
          up={rel.up}
          down={rel.down}
          {byId}
          {drag}
          {over}
          {now}
          ontoggle={() => toggle(stage.milestone.id)}
          onmenu={(action) => {
            if (action === 'edit') modal = { kind: 'edit', milestone: stage.milestone };
            else if (action === 'delete') modal = { kind: 'delete', milestone: stage.milestone };
            else onchat();
          }}
          onhover={(id) => (hovered = id)}
          {onopen}
          ondrag={(d) => {
            drag = d;
            if (!d) over = undefined;
          }}
          onover={(o) => (over = o)}
          ondrop={drop}
        />
      {/each}
    </div>
  {/if}
</div>

{#if modal?.kind === 'new' || modal?.kind === 'edit'}
  <StageModal
    milestone={modal.kind === 'edit' ? modal.milestone : undefined}
    onsave={(input) => void save(input)}
    onclose={() => (modal = undefined)}
  />
{:else if modal?.kind === 'delete'}
  {@const m = modal.milestone}
  <DeleteStage
    milestone={m}
    tasks={list.find((s) => s.milestone.id === m.id)?.tasks.length ?? 0}
    heir={heirOf(data.milestones, m.id)}
    onconfirm={() => void remove(m)}
    onclose={() => (modal = undefined)}
  />
{/if}

<style>
  .screen {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--sk-fill-5);
  }

  .top {
    flex: none;
    padding: 20px 24px 14px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .titles {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
  }

  h1 {
    margin: 0;
    font-size: var(--sk-fs-15);
    font-weight: 700;
    color: var(--sk-text-5);
    letter-spacing: -0.01em;
  }

  .sub {
    margin-top: 5px;
    font-size: var(--sk-fs-6);
    color: var(--sk-text-17);
  }

  .actions {
    flex: none;
    display: flex;
    gap: 8px;
  }

  .secondary,
  .primary {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    border: none;
    border-radius: 8px;
    font-size: var(--sk-fs-5);
    cursor: pointer;
  }

  .secondary {
    padding: 0 13px;
    background: var(--sk-fill-20);
    color: var(--sk-text-6);
    font-weight: 600;
  }

  .secondary:hover {
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }

  .primary {
    padding: 0 14px;
    background: var(--sk-accent);
    color: var(--sk-text-1);
    font-weight: 700;
  }

  .primary:hover {
    background: var(--sk-accent-hover);
  }

  .primary.big {
    height: 34px;
    padding: 0 15px;
    font-size: var(--sk-fs-6);
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .hide {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    height: 30px;
    padding: 0 10px 0 8px;
    border-radius: 8px;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-10);
    cursor: pointer;
    outline: none;
  }

  .hide:hover {
    background: var(--sk-fill-11);
    color: var(--sk-text-6);
  }

  .box {
    display: inline-flex;
    pointer-events: none;
  }

  .spacer {
    flex: 1;
  }

  .all {
    width: 30px;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-17);
    cursor: pointer;
  }

  .all:hover {
    background: var(--sk-fill-11);
    color: var(--sk-text-2);
  }

  .stages {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 24px 28px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
    padding: 0 24px 60px;
    text-align: center;
  }

  .empty-icon {
    display: inline-flex;
    color: var(--sk-text-28);
  }

  .empty-copy {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 380px;
  }

  .empty-title {
    font-size: var(--sk-fs-10);
    font-weight: 700;
    color: var(--sk-text-6);
  }

  .empty-text {
    font-size: var(--sk-fs-6);
    line-height: 1.6;
    color: var(--sk-text-19);
    text-wrap: pretty;
  }
</style>
