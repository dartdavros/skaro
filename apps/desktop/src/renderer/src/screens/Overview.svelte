<script lang="ts">
  import { AgentLogo, Icon, t, tn } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import type { OverviewTask, ProjectEvent, ProjectOverview } from '../../../shared/ipc';
  import { clock as clockState } from '../feed/context.svelte';
  import { agentName, clock, prettyModel } from '../feed/format';
  import '../feed/i18n';

  /**
   * "Обзор" (ProjectOverview mockup): what waits for the user, what agents work on now, the
   * project start checklist, milestones and recent events.
   */
  let {
    projectId,
    onsection,
    ontask,
  }: {
    projectId: string;
    onsection: (section: 'docs' | 'plan' | 'tasks' | 'chat') => void;
    ontask: (taskId: string) => void;
  } = $props();

  let data = $state.raw<ProjectOverview | undefined>();

  async function reload(): Promise<void> {
    data = await window.skaro.invoke('project.overview', projectId).catch(() => data);
  }
  void reload();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (p: { projectId: string }): void => {
    if (p.projectId !== projectId) return;
    clearTimeout(timer);
    timer = setTimeout(() => void reload(), 300);
  };
  const off = [
    window.skaro.on('project.changed', soon),
    window.skaro.on('task.changed', soon),
    window.skaro.on('chats.changed', soon),
  ];
  onDestroy(() => {
    clearTimeout(timer);
    for (const stop of off) stop();
  });

  function ago(at: number, now: number): string {
    const m = Math.floor((now - at) / 60_000);
    if (m < 1) return t('agoShort.now');
    if (m < 60) return t('agoShort.min', { n: m });
    if (m < 1440) return t('agoShort.hour', { n: Math.round(m / 60) });
    const d = Math.round(m / 1440);
    return d === 1 ? t('ago.yesterday') : t('agoShort.day', { n: d });
  }

  /** "3 дн назад": the full form, for the checklist. */
  function agoLong(at: number, now: number): string {
    const m = Math.floor((now - at) / 60_000);
    if (m < 1) return t('ago.now');
    if (m < 60) return t('ago.min', { n: m });
    if (m < 1440) return t('ago.hour', { n: Math.round(m / 60) });
    const d = Math.round(m / 1440);
    if (d === 1) return t('ago.yesterday');
    if (d < 30) return t('ago.day', { n: d });
    return t('ago.month', { n: Math.round(d / 30) });
  }

  function agentLine(task: OverviewTask): string {
    return task.model
      ? `${agentName(task.agent)} · ${prettyModel(task.model)}`
      : agentName(task.agent);
  }

  function eventView(e: ProjectEvent): { text: string; color: string } {
    const d = e.data as Record<string, string | number | undefined>;
    const task = `${d['task'] ?? ''}${e.taskTitle ? ` · ${e.taskTitle}` : ''}`;
    switch (e.kind) {
      case 'merged':
        return {
          text: t('event.merged', { task, base: d['base'] ?? '' }),
          color: 'var(--sk-text-15)',
        };
      case 'task_review':
        return { text: t('event.review', { task }), color: 'var(--sk-accent)' };
      case 'task_failed':
        return { text: t('event.failed', { task }), color: 'var(--sk-error)' };
      case 'waiting':
        return {
          text: t(
            `event.waiting.${d['what'] === 'approval' ? (d['detail'] ? 'approvalOf' : 'approval') : d['what'] === 'plan_approval' ? 'plan' : 'answer'}`,
            {
              task: String(d['task'] ?? ''),
              detail: String(d['detail'] ?? ''),
            },
          ),
          color: 'var(--sk-accent)',
        };
      case 'adr_accepted':
        return {
          text: t('event.adr', { id: d['id'] ?? '', title: d['title'] ?? '' }),
          color: 'var(--sk-accent)',
        };
      case 'tasks_created': {
        const text = tn('event.tasks', Number(d['count'] ?? 0));
        return {
          text: d['milestone']
            ? t('event.tasks.in', {
                text,
                milestone: `${d['milestone']}${e.milestoneTitle ? ` · ${e.milestoneTitle}` : ''}`,
              })
            : text,
          color: 'var(--sk-text-18)',
        };
      }
      case 'doc_updated':
        return { text: t('event.doc', { path: d['path'] ?? '' }), color: 'var(--sk-text-18)' };
      case 'task_changed':
        return { text: t('event.taskChanged', { task }), color: 'var(--sk-text-18)' };
      case 'task_deleted':
        return {
          text: t('event.deleted', { task: `${d['task'] ?? ''} · ${d['title'] ?? ''}` }),
          color: 'var(--sk-error)',
        };
      default:
        return { text: e.kind, color: 'var(--sk-text-18)' };
    }
  }

  /** "Старт проекта": brief, architecture, milestones and tasks — done or to discuss. */
  const checklist = $derived.by(() => {
    if (!data) return [];
    const s = data.start;
    const now = clockState.now;
    const planDone = s.milestones > 0 && s.tasks > 0 && !s.emptyMilestone;
    return [
      {
        title: t('start.brief'),
        done: !!s.brief,
        note: s.brief
          ? t('start.brief.done', { when: agoLong(s.brief.updatedAt, now) })
          : t('start.brief.todo'),
        go: s.brief ? ('docs' as const) : ('chat' as const),
      },
      {
        title: t('start.architecture'),
        done: !!s.architecture,
        note: s.architecture
          ? t('start.architecture.done', {
              adrs: s.architecture.adrs,
              rules: tn('start.rules', s.architecture.rules),
            })
          : t('start.architecture.todo'),
        go: s.architecture ? ('docs' as const) : ('chat' as const),
      },
      {
        title: t('start.plan'),
        done: planDone,
        note: planDone
          ? t('start.plan.done', {
              milestones: tn('start.milestones', s.milestones),
              tasks: tn('start.tasks', s.tasks),
            })
          : s.emptyMilestone
            ? t('start.plan.empty', { id: s.emptyMilestone.id, title: s.emptyMilestone.title })
            : t('start.plan.todo'),
        go: planDone ? ('plan' as const) : ('chat' as const),
      },
    ];
  });
  const showStart = $derived(
    data !== undefined && !data.start.hidden && checklist.some((c) => !c.done),
  );

  /** The milestone in work: the first one not done. */
  const current = $derived(data?.milestones.find((m) => m.total > 0 && m.done < m.total)?.id);

  function hideStart(): void {
    void window.skaro
      .invoke('app.setSetting', `overview.${projectId}.startHidden`, true)
      .then(() => reload());
  }
</script>

{#snippet taskCard(task: OverviewTask, working: boolean)}
  <div
    class="task"
    role="button"
    tabindex="0"
    onclick={() => ontask(task.id)}
    onkeydown={(e) => e.key === 'Enter' && ontask(task.id)}
  >
    <span
      class="task-dot"
      class:working
      data-tip={working
        ? t('overview.working.tip')
        : task.status === 'review'
          ? t('task.status.review')
          : t('task.status.needs_answer')}
    ></span>
    <div class="task-body">
      <div class="task-top">
        <span class="task-id">{task.id}</span>
        <span class="task-title">{task.title}</span>
        <span class="task-when"
          >{working ? clock(clockState.now - task.since) : ago(task.since, clockState.now)}</span
        >
      </div>
      <div class="task-meta">
        {#if task.milestone}<span>{task.milestone.id} · {task.milestone.title}</span>{/if}
        {#if task.stats}
          <span class="mono">{tn('overview.files', task.stats.files)}</span>
          <span class="mono plus">+{task.stats.added}</span>
          <span class="mono minus">−{task.stats.removed}</span>
        {/if}
        <span class="spacer"></span>
        <span class="agent" data-tip={agentLine(task)}
          ><AgentLogo agent={task.agent} size={13} /></span
        >
      </div>
    </div>
  </div>
{/snippet}

{#if data}
  <div class="overview">
    <div class="head">
      <div class="titles">
        <h1 class="title">{data.name}</h1>
        <div class="meta">
          <span data-tip={t('overview.path.tip')}>{data.path}</span>
          {#if data.branch}
            <span class="branch"><Icon name="branch" size={12} stroke={1.9} />{data.branch}</span>
          {/if}
          {#if data.clean}
            <span class="clean" data-tip={t('overview.clean.tip')}>{t('overview.clean')}</span>
          {/if}
        </div>
      </div>
      <div class="actions">
        <button
          type="button"
          class="action"
          data-tip={t('overview.editor.tip')}
          onclick={() => void window.skaro.invoke('projects.openIn', projectId, 'editor')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
            ><path d="M15 3h6v6"></path><path d="M10 14 21 3"></path><path
              d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
            ></path></svg
          >
          {t('overview.editor')}
        </button>
        <button
          type="button"
          class="action"
          data-tip={t('overview.terminal.tip')}
          onclick={() => void window.skaro.invoke('projects.openIn', projectId, 'terminal')}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.9"
            stroke-linecap="round"
            stroke-linejoin="round"><path d="m4 17 6-6-6-6M12 19h8"></path></svg
          >
          {t('overview.terminal')}
        </button>
      </div>
    </div>

    <div class="columns">
      <div class="col">
        {#if data.attention.length}
          <section>
            <div class="section-head">
              <h2>{t('overview.attention')}</h2>
              <span class="count">{data.attention.length}</span>
            </div>
            <div class="stack">
              {#each data.attention as task (task.id)}{@render taskCard(task, false)}{/each}
            </div>
          </section>
        {/if}

        {#if data.running.length || data.queued.length}
          <section>
            <div class="section-head"><h2>{t('overview.running')}</h2></div>
            <div class="stack">
              {#each data.running as task (task.id)}{@render taskCard(task, true)}{/each}
              {#each data.queued as q (q.id)}
                <div class="queued">
                  <Icon name="clock" size={14} stroke={1.9} color="var(--sk-text-18)" />
                  <span>{t('overview.queued', { id: q.id, title: q.title })}</span>
                </div>
              {/each}
            </div>
          </section>
        {/if}

        {#if showStart}
          <section class="start">
            <div class="start-head">
              <div>
                <h2>{t('start.title')}</h2>
                <div class="start-note">{t('start.note')}</div>
              </div>
              <button type="button" class="hide" onclick={hideStart}>{t('start.hide')}</button>
            </div>
            <div class="start-list">
              {#each checklist as item (item.title)}
                <div class="start-item">
                  {#if item.done}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--sk-text-15)"
                      stroke-width="2.2"
                      stroke-linecap="round"
                      stroke-linejoin="round"><path d="M20 6 9 17l-5-5"></path></svg
                    >
                  {:else}
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="var(--sk-text-22)"
                      ><circle cx="12" cy="12" r="8" stroke-width="1.8" stroke-dasharray="3 3"
                      ></circle></svg
                    >
                  {/if}
                  <div class="start-texts">
                    <span class="start-title" class:done={item.done}>{item.title}</span>
                    <span class="start-item-note">{item.note}</span>
                  </div>
                  <button
                    type="button"
                    class="start-btn"
                    class:primary={!item.done}
                    onclick={() => onsection(item.go)}
                    >{item.done ? t('start.open') : t('start.discuss')}</button
                  >
                </div>
              {/each}
            </div>
          </section>
        {/if}
      </div>

      <div class="col">
        {#if data.milestones.length}
          <section>
            <div class="section-head between">
              <h2>{t('overview.milestones')}</h2>
              <button type="button" class="link" onclick={() => onsection('plan')}
                >{t('overview.plan')}</button
              >
            </div>
            <div class="box milestones">
              {#each data.milestones as m (m.id)}
                {@const pct = m.total ? Math.round((m.done / m.total) * 100) : 0}
                <div class="ms">
                  <div class="ms-top">
                    <span class="ms-id">{m.id}</span>
                    <span class="ms-name" class:current={m.id === current}>{m.title}</span>
                    <span class="ms-count">{m.done} / {m.total}</span>
                  </div>
                  <div class="ms-bar">
                    <div
                      class="ms-fill"
                      style="width: {pct}%; background: {pct === 100
                        ? 'var(--sk-fill-41)'
                        : m.id === current
                          ? 'var(--sk-accent)'
                          : 'var(--sk-fill-26)'}"
                    ></div>
                  </div>
                </div>
              {/each}
            </div>
          </section>
        {/if}

        {#if data.events.length}
          <section>
            <div class="section-head"><h2>{t('overview.events')}</h2></div>
            <div class="box events">
              {#each data.events as e, i (i)}
                {@const v = eventView(e)}
                <div class="event">
                  <span class="event-dot" style="background: {v.color}"></span>
                  <span class="event-text">{v.text}</span>
                  <span class="event-when">{ago(e.at, clockState.now)}</span>
                </div>
              {/each}
            </div>
          </section>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 20px;
  }

  .titles {
    min-width: 0;
  }

  .title {
    margin: 0;
    font-size: var(--sk-fs-15);
    font-weight: 700;
    color: var(--sk-text-5);
    letter-spacing: -0.01em;
  }

  .meta {
    margin-top: 6px;
    display: flex;
    align-items: center;
    gap: 12px;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-17);
  }

  .branch {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--sk-text-10);
  }

  .clean {
    color: var(--sk-text-13);
  }

  .actions {
    flex: none;
    display: flex;
    gap: 8px;
  }

  .action {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    height: 32px;
    padding: 0 12px;
    border: none;
    border-radius: 8px;
    background: var(--sk-fill-17);
    color: var(--sk-text-2);
    font: inherit;
    font-size: var(--sk-fs-5);
    font-weight: 600;
    cursor: pointer;
  }

  .action:hover {
    background: var(--sk-fill-18);
  }

  .columns {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 312px;
    gap: 18px;
    align-items: start;
  }

  .col {
    display: flex;
    flex-direction: column;
    gap: 16px;
    min-width: 0;
  }

  .section-head {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 9px;
  }

  .section-head.between {
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-size: var(--sk-fs-6);
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sk-text-13);
  }

  .count {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    color: var(--sk-accent);
  }

  .stack {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .task {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 12px 13px;
    border-radius: 9px;
    background: var(--sk-fill-15);
    cursor: pointer;
    outline: none;
  }

  .task:hover {
    background: var(--sk-fill-20);
  }

  .task-dot {
    flex: none;
    margin-top: 5px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--sk-accent);
  }

  .task-dot.working {
    background: var(--sk-fill-41);
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .task-body {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .task-top {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .task-id {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    color: var(--sk-text-17);
  }

  .task-title {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-8);
    font-weight: 600;
    color: var(--sk-text-6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .task-when {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-21);
  }

  .task-meta {
    display: flex;
    align-items: center;
    gap: 9px;
    min-width: 0;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-19);
  }

  .task-meta > span {
    flex: none;
  }

  .task-meta .spacer {
    flex: 1;
  }

  .mono {
    font-family: var(--sk-mono);
  }

  .plus {
    color: var(--sk-green-2);
  }

  .minus {
    color: var(--sk-error);
  }

  .agent {
    display: inline-flex;
  }

  .queued {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 13px;
    border-radius: 9px;
    background: var(--sk-fill-9);
    font-size: var(--sk-fs-5);
    color: var(--sk-text-19);
  }

  .start {
    padding: 14px 15px;
    border-radius: 9px;
    background: var(--sk-fill-9);
  }

  .start-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }

  .start-note {
    margin-top: 4px;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-17);
  }

  .hide {
    flex: none;
    height: 26px;
    padding: 0 10px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--sk-text-17);
    font: inherit;
    font-size: var(--sk-fs-4);
    font-weight: 600;
    cursor: pointer;
  }

  .hide:hover {
    background: var(--sk-fill-20);
    color: var(--sk-text-2);
  }

  .start-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .start-item {
    display: flex;
    align-items: flex-start;
    gap: 11px;
    padding: 9px 2px;
  }

  .start-item svg {
    flex: none;
  }

  .start-texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .start-title {
    font-size: var(--sk-fs-7);
    font-weight: 600;
    color: var(--sk-text-10);
  }

  .start-title.done {
    color: var(--sk-text-7);
  }

  .start-item-note {
    font-size: var(--sk-fs-5);
    color: var(--sk-text-17);
    text-wrap: pretty;
  }

  .start-btn {
    flex: none;
    height: 27px;
    padding: 0 11px;
    border: none;
    border-radius: 7px;
    background: var(--sk-fill-20);
    color: var(--sk-text-10);
    font: inherit;
    font-size: var(--sk-fs-4);
    font-weight: 600;
    cursor: pointer;
  }

  .start-btn.primary {
    background: var(--sk-accent);
    color: var(--sk-text-1);
  }

  .start-btn:hover {
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }

  .start-btn.primary:hover {
    background: var(--sk-accent-hover);
    color: var(--sk-text-1);
  }

  .link {
    padding: 0;
    border: none;
    background: none;
    font: inherit;
    font-size: var(--sk-fs-4);
    font-weight: 600;
    color: var(--sk-accent);
    cursor: pointer;
  }

  .link:hover {
    color: var(--sk-teal-1);
    text-decoration: underline;
  }

  .box {
    border-radius: 9px;
    background: var(--sk-fill-15);
  }

  .milestones {
    padding: 4px 13px;
  }

  .ms {
    padding: 11px 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .ms-top {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .ms-id {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    font-weight: 600;
    color: var(--sk-text-17);
  }

  .ms-name {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-6);
    font-weight: 600;
    color: var(--sk-text-13);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ms-name.current {
    color: var(--sk-text-6);
  }

  .ms-count {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-17);
  }

  .ms-bar {
    height: 4px;
    border-radius: 3px;
    background: var(--sk-fill-21);
    overflow: hidden;
  }

  .ms-fill {
    height: 100%;
    border-radius: 3px;
  }

  .events {
    padding: 6px 13px;
    display: flex;
    flex-direction: column;
  }

  .event {
    display: flex;
    align-items: baseline;
    gap: 9px;
    padding: 8px 0;
    min-width: 0;
  }

  .event-dot {
    flex: none;
    position: relative;
    top: -2px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
  }

  .event-text {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-13);
    text-wrap: pretty;
  }

  .event-when {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-2);
    color: var(--sk-text-21);
  }
</style>
