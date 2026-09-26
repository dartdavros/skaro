<script lang="ts">
  import { ActionMenu, AgentLogo, Banner, Button, Icon, Segmented, t, TextField } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import { agentReady, type ProjectCard } from '../../../shared/ipc';
  import { agents } from '../agents.svelte';
  import { clock } from '../feed/context.svelte';
  import { agentName, prettyModel } from '../feed/format';

  /**
   * "Проекты" (Projects mockup): search, sorting, grid or list of project cards with task
   * statuses, the current milestone, tasks agents work on now, branch and last activity.
   */
  let {
    onopen,
    onadd,
    onsettings,
    onchanged,
  }: {
    onopen: (id: string) => void;
    onadd: () => void;
    onsettings: () => void;
    /** A project was removed or found again: the app reloads its list. */
    onchanged: () => void;
  } = $props();

  type Sort = 'attention' | 'recent' | 'name';
  type View = 'grid' | 'list';

  let cards = $state.raw<ProjectCard[]>([]);
  let query = $state('');
  let sort = $state<Sort>('attention');
  let view = $state<View>('grid');
  let loaded = $state(false);

  async function reload(): Promise<void> {
    cards = await window.skaro.invoke('projects.overview').catch(() => cards);
    loaded = true;
  }
  void reload();
  void window.skaro.invoke('app.getSetting', 'ui.projects').then((saved) => {
    const s = saved as { sort?: Sort; view?: View } | null;
    if (s?.sort) sort = s.sort;
    if (s?.view) view = s.view;
  });

  // Statuses change while agents work: the cards follow.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const soon = (): void => {
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

  function remember(): void {
    void window.skaro.invoke('app.setSetting', 'ui.projects', { sort, view });
  }

  // Projects mockup: an agent that is not downloaded or not signed in, while another one works.
  const missingAgents = $derived(agents.list.filter((a) => !a.checking && !agentReady(a)));
  const readyAgents = $derived(agents.list.filter(agentReady));

  const score = (c: ProjectCard) => c.counts.needs * 10 + c.counts.review * 5 + c.counts.failed * 3;
  const shown = $derived.by(() => {
    const q = query.trim().toLowerCase();
    const list = cards.filter((c) => !q || `${c.name} ${c.path}`.toLowerCase().includes(q));
    if (sort === 'attention') {
      return list.toSorted((a, b) => score(b) - score(a) || b.activeAt - a.activeAt);
    }
    if (sort === 'recent') return list.toSorted((a, b) => b.activeAt - a.activeAt);
    return list.toSorted((a, b) => a.name.localeCompare(b.name, 'ru'));
  });

  const AVATARS = [
    ['var(--sk-fill-21)', 'var(--sk-warn)'],
    ['var(--sk-fill-21)', 'var(--sk-blue-3)'],
    ['var(--sk-fill-21)', 'var(--sk-red-3)'],
    ['var(--sk-fill-21)', 'var(--sk-green-1)'],
    ['var(--sk-fill-21)', 'var(--sk-purple-1)'],
    ['var(--sk-fill-24)', 'var(--sk-text-12)'],
  ] as const;

  function avatar(card: ProjectCard): { bg: string; fg: string; initials: string } {
    let hash = 0;
    for (const ch of card.name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const [bg, fg] = AVATARS[hash % AVATARS.length]!;
    const initials = card.name
      .split(/[\s_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
    return { bg, fg, initials };
  }

  /** ~/code/shop-api for a folder in the home directory. */
  function shortPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/^(?:[A-Za-z]:)?\/(?:Users|home)\/[^/]+(?=\/|$)/, '~');
  }

  function ago(at: number, now: number): string {
    const m = Math.floor((now - at) / 60_000);
    if (m < 1) return t('ago.now');
    if (m < 60) return t('ago.min', { n: m });
    if (m < 1440) return t('ago.hour', { n: Math.round(m / 60) });
    const d = Math.round(m / 1440);
    if (d === 1) return t('ago.yesterday');
    if (d < 30) return t('ago.day', { n: d });
    return t('ago.month', { n: Math.round(d / 30) });
  }

  function marks(c: ProjectCard): { count: number; color: string; pulse: boolean; tip: string }[] {
    return [
      { count: c.counts.working, color: 'var(--sk-text-15)', pulse: true, key: 'working' },
      { count: c.counts.needs, color: 'var(--sk-accent)', pulse: false, key: 'needs' },
      { count: c.counts.review, color: 'var(--sk-accent)', pulse: false, key: 'review' },
      { count: c.counts.failed, color: 'var(--sk-error)', pulse: false, key: 'failed' },
    ]
      .filter((m) => m.count > 0)
      .map((m) => ({ ...m, tip: t(`projects.mark.${m.key}`, { n: m.count }) }));
  }

  function agentLine(agent: string, model?: string): string {
    return model ? `${agentName(agent)} · ${prettyModel(model)}` : agentName(agent);
  }

  function menu(c: ProjectCard) {
    return [
      {
        label: t('projects.menu.explorer'),
        onselect: () => void window.skaro.invoke('projects.openIn', c.id, 'explorer'),
      },
      {
        label: t('projects.menu.terminal'),
        onselect: () => void window.skaro.invoke('projects.openIn', c.id, 'terminal'),
      },
      {
        label: t('projects.menu.editor'),
        onselect: () => void window.skaro.invoke('projects.openIn', c.id, 'editor'),
      },
      'separator' as const,
      { label: t('projects.remove'), danger: true, onselect: () => void remove(c.id) },
    ];
  }

  async function remove(id: string): Promise<void> {
    await window.skaro.invoke('projects.remove', id);
    onchanged();
    await reload();
  }

  async function relocate(card: ProjectCard): Promise<void> {
    const path = await window.skaro.invoke('projects.pickFolder', undefined);
    if (!path) return;
    await window.skaro.invoke('projects.relocate', card.id, path);
    onchanged();
    await reload();
  }
</script>

<div class="projects">
  <div class="head">
    <h1 class="title">{t('app.home')}</h1>
    <Button variant="primary" data-tip={t('home.add.tip')} onclick={onadd}
      ><Icon name="plus" size={15} stroke={2.6} />{t('home.add')}</Button
    >
  </div>

  {#if missingAgents.length && readyAgents.length && !agents.bannerHidden}
    <div class="banner">
      <Banner
        kind="warning"
        title={t('home.agent.missing', {
          name: missingAgents.map((a) => agentName(a.id)).join(', '),
        })}
        text={t('home.agent.missing.text', {
          ready: readyAgents.map((a) => agentName(a.id)).join(', '),
        })}
        action={t('home.agent.settings')}
        onaction={onsettings}
        onclose={() => (agents.bannerHidden = true)}
      />
    </div>
  {/if}

  <div class="toolbar">
    <div class="search">
      <TextField search placeholder={t('projects.search')} bind:value={query} />
    </div>
    <Segmented
      bind:value={() => sort, (v) => ((sort = v), remember())}
      label={t('projects.sort')}
      options={[
        { value: 'attention', label: t('projects.sort.attention') },
        { value: 'recent', label: t('projects.sort.recent') },
        { value: 'name', label: t('projects.sort.name') },
      ]}
    />
    <span class="spacer"></span>
    <Segmented
      bind:value={() => view, (v) => ((view = v), remember())}
      label={t('projects.view')}
      options={[
        { value: 'grid', label: t('projects.view.grid'), icon: 'grid' },
        { value: 'list', label: t('projects.view.list'), icon: 'list' },
      ]}
    />
  </div>

  {#if loaded && query.trim() && !shown.length}
    <div class="nothing">
      <div class="nothing-title">{t('projects.nothing')}</div>
      <div class="nothing-text">{t('projects.nothing.text', { q: query.trim() })}</div>
    </div>
  {:else if view === 'grid'}
    <div class="grid">
      {#each shown as c (c.id)}
        {@const av = avatar(c)}
        <div
          class="card"
          role="button"
          tabindex="0"
          onclick={() => !c.missing && onopen(c.id)}
          onkeydown={(e) => e.key === 'Enter' && !c.missing && onopen(c.id)}
        >
          <div class="card-body">
            <div class="top">
              <div class="avatar" style="background: {av.bg}; color: {av.fg}">{av.initials}</div>
              <div class="names">
                <div class="name">{c.name}</div>
                <div class="path" data-tip={c.path}>{shortPath(c.path)}</div>
              </div>
              <!-- The menu opens over the card; clicks there do not open the project. -->
              <div
                role="presentation"
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => e.stopPropagation()}
              >
                <ActionMenu size="sm" align="right" items={menu(c)} />
              </div>
            </div>

            {#if c.missing}
              <div class="missing">
                <div class="missing-line">
                  <svg
                    width="15"
                    height="15"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="var(--sk-error)"
                    stroke-width="1.9"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    ><path
                      d="M4 19V6a1 1 0 0 1 1-1h4l2 2h7a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z"
                    ></path><path d="m10 11 4 4M14 11l-4 4"></path></svg
                  >
                  <span>{t('projects.missing')}</span>
                </div>
                <div class="missing-actions">
                  <button
                    type="button"
                    class="find"
                    onclick={(e) => {
                      e.stopPropagation();
                      void relocate(c);
                    }}>{t('projects.find')}</button
                  >
                  <button
                    type="button"
                    class="drop"
                    onclick={(e) => {
                      e.stopPropagation();
                      void remove(c.id);
                    }}>{t('projects.remove')}</button
                  >
                </div>
              </div>
            {:else}
              <div class="ok">
                {#if marks(c).length}
                  <div class="marks">
                    {#each marks(c) as m (m.tip)}
                      <span class="mark" data-tip={m.tip}
                        ><span class="dot" class:pulse={m.pulse} style="background: {m.color}"
                        ></span>{m.count}</span
                      >
                    {/each}
                  </div>
                {/if}
                <div>
                  <div class="ms">
                    {#if c.milestone}<span class="ms-id">{c.milestone.id}</span>{/if}
                    <span class="ms-name">{c.milestone?.title ?? t('projects.noPlan')}</span>
                    {#if c.milestone}<span class="ms-count"
                        >{t('projects.ofTotal', {
                          done: c.milestone.done,
                          total: c.milestone.total,
                        })}</span
                      >{/if}
                  </div>
                  <div class="bar">
                    {#if c.milestone}
                      {@const pct = Math.round((c.milestone.done / c.milestone.total) * 100)}
                      <div
                        class="fill"
                        style="width: {pct}%; background: {pct === 100
                          ? 'var(--sk-fill-41)'
                          : 'var(--sk-fill-39)'}"
                      ></div>
                    {/if}
                  </div>
                </div>
                {#if c.running.length}
                  <div class="runs">
                    {#each c.running.slice(0, 2) as r (r.id)}
                      <div class="run">
                        <span class="run-dot"></span>
                        <span class="run-id">{r.id}</span>
                        <span class="run-title">{r.title}</span>
                        <span class="run-agent" data-tip={agentLine(r.agent, r.model)}
                          ><AgentLogo agent={r.agent} size={13} /></span
                        >
                      </div>
                    {/each}
                    {#if c.running.length > 2}
                      <div class="more">{t('projects.moreRuns', { n: c.running.length - 2 })}</div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/if}

            <div class="foot">
              <span class="activity">{ago(c.activeAt, clock.now)}</span>
              {#if c.branch || c.missing}
                <span class="branch"
                  ><Icon name="branch" size={12} stroke={1.9} />{c.branch ?? '—'}</span
                >
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {:else}
    <div class="table">
      <div class="row head-row">
        <div>{t('projects.col.project')}</div>
        <div>{t('projects.col.milestone')}</div>
        <div>{t('projects.col.statuses')}</div>
        <div>{t('projects.col.agent')}</div>
        <div></div>
      </div>
      {#each shown as c (c.id)}
        {@const av = avatar(c)}
        <div
          class="row item-row"
          role="button"
          tabindex="0"
          onclick={() => !c.missing && onopen(c.id)}
          onkeydown={(e) => e.key === 'Enter' && !c.missing && onopen(c.id)}
        >
          <div class="cell-project">
            <div class="avatar small" style="background: {av.bg}; color: {av.fg}">
              {av.initials}
            </div>
            <div class="names">
              <div class="name small">{c.name}</div>
              <div class="path small">{shortPath(c.path)}</div>
            </div>
          </div>
          <div class="cell-ms">
            {#if !c.missing}
              <div class="ms small">
                {#if c.milestone}<span class="ms-id">{c.milestone.id}</span>{/if}
                <span class="ms-name">{c.milestone?.title ?? t('projects.noPlan')}</span>
                {#if c.milestone}<span class="ms-count"
                    >{t('projects.ofTotal', {
                      done: c.milestone.done,
                      total: c.milestone.total,
                    })}</span
                  >{/if}
              </div>
              <div class="bar thin">
                {#if c.milestone}
                  {@const pct = Math.round((c.milestone.done / c.milestone.total) * 100)}
                  <div
                    class="fill"
                    style="width: {pct}%; background: {pct === 100
                      ? 'var(--sk-fill-41)'
                      : 'var(--sk-fill-39)'}"
                  ></div>
                {/if}
              </div>
            {/if}
          </div>
          <div class="marks">
            {#each marks(c) as m (m.tip)}
              <span class="mark" data-tip={m.tip}
                ><span class="dot" class:pulse={m.pulse} style="background: {m.color}"
                ></span>{m.count}</span
              >
            {/each}
          </div>
          <div
            class="cell-agent"
            data-tip={agentLine(c.agent, c.model)}
            style="color: {c.counts.working ? 'var(--sk-text-11)' : 'var(--sk-text-18)'}"
          >
            <AgentLogo agent={c.agent} size={13} />
          </div>
          <div class="cell-time">{ago(c.activeAt, clock.now)}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .projects {
    display: flex;
    flex-direction: column;
  }

  .head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 20px;
    margin-bottom: 20px;
  }

  .title {
    margin: 0;
    font-size: var(--sk-fs-16);
    font-weight: 700;
    color: var(--sk-text-5);
    letter-spacing: -0.01em;
  }

  .banner {
    margin-bottom: 16px;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 16px;
  }

  .search {
    flex: none;
    width: 268px;
  }

  .spacer {
    flex: 1;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 13px;
  }

  .card {
    position: relative;
    display: flex;
    flex-direction: column;
    border-radius: 10px;
    background: var(--sk-fill-11);
    cursor: pointer;
    outline: none;
  }

  .card:hover {
    background: var(--sk-fill-18);
  }

  .card-body {
    flex: 1;
    padding: 13px 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 11px;
  }

  .top {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }

  .avatar {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-5);
    font-weight: 600;
  }

  .avatar.small {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    font-size: var(--sk-fs-2);
  }

  .names {
    flex: 1;
    min-width: 0;
  }

  .name {
    font-size: var(--sk-fs-9);
    font-weight: 600;
    color: var(--sk-text-6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name.small {
    font-size: var(--sk-fs-7);
  }

  .path {
    margin-top: 2px;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-2);
    color: var(--sk-text-17);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .path.small {
    margin-top: 0;
    font-size: var(--sk-fs-1);
  }

  .missing {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding-top: 2px;
  }

  .missing-line {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: var(--sk-fs-5);
    line-height: 1.5;
    color: var(--sk-text-6);
  }

  .missing-line svg {
    flex: none;
    margin-top: 1px;
  }

  .missing-actions {
    display: flex;
    gap: 7px;
  }

  .find,
  .drop {
    height: 27px;
    padding: 0 11px;
    border: none;
    border-radius: 7px;
    font: inherit;
    font-size: var(--sk-fs-4);
    font-weight: 600;
    cursor: pointer;
  }

  .find {
    background: var(--sk-error-a18);
    color: var(--sk-red-2);
  }

  .find:hover {
    background: var(--sk-error-a28);
    color: var(--sk-text-1);
  }

  .drop {
    background: var(--sk-fill-23);
    color: var(--sk-text-10);
  }

  .drop:hover {
    background: var(--sk-fill-29);
    color: var(--sk-text-2);
  }

  .ok {
    display: flex;
    flex-direction: column;
    gap: 11px;
  }

  .marks {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 14px;
  }

  .mark {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 23px;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-4);
    color: var(--sk-text-13);
    cursor: default;
  }

  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
  }

  .dot.pulse {
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .ms {
    display: flex;
    align-items: baseline;
    gap: 7px;
    margin-bottom: 7px;
  }

  .ms.small {
    gap: 6px;
    margin-bottom: 0;
  }

  .ms-id {
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    font-weight: 600;
    color: var(--sk-text-14);
  }

  .ms.small .ms-id {
    font-size: var(--sk-fs-2);
    font-weight: 400;
  }

  .ms-name {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-6);
    color: var(--sk-text-6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ms.small .ms-name {
    font-size: var(--sk-fs-5);
  }

  .ms-count {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-17);
  }

  .ms.small .ms-count {
    font-size: var(--sk-fs-1);
  }

  .bar {
    height: 4px;
    border-radius: 3px;
    background: var(--sk-fill-20);
    overflow: hidden;
  }

  .bar.thin {
    margin-top: 6px;
    height: 3px;
    border-radius: 2px;
  }

  .fill {
    height: 100%;
    border-radius: inherit;
  }

  .runs {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 9px 10px;
    border-radius: 8px;
    background: var(--sk-deep);
  }

  .run {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .run-dot {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--sk-fill-41);
    animation: skPulse 1.6s ease-in-out infinite;
  }

  .run-id {
    flex: none;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-3);
    color: var(--sk-text-14);
  }

  .run-title {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-6);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .run-agent {
    flex: none;
    display: inline-flex;
    align-items: center;
  }

  .more {
    padding-left: 14px;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-17);
  }

  .foot {
    margin-top: auto;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding-top: 10px;
    border-top: 1px solid var(--sk-fill-10);
  }

  .activity {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-17);
  }

  .branch {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-2);
    color: var(--sk-text-17);
  }

  .table {
    border-radius: 10px;
    overflow: hidden;
  }

  .row {
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1.4fr) minmax(0, 1.6fr) 132px 104px;
    gap: 14px;
    align-items: center;
  }

  .head-row {
    padding: 9px 14px;
    background: var(--sk-deep);
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--sk-text-17);
  }

  .item-row {
    padding: 11px 14px;
    background: var(--sk-fill-11);
    border-bottom: 1px solid var(--sk-fill-3);
    cursor: pointer;
    outline: none;
  }

  .item-row:hover {
    background: var(--sk-fill-18);
  }

  .cell-project {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .cell-ms {
    min-width: 0;
  }

  .cell-agent {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }

  .cell-time {
    text-align: right;
    font-size: var(--sk-fs-3);
    color: var(--sk-text-17);
  }

  .nothing {
    padding: 54px 20px;
    text-align: center;
    border-radius: 10px;
    background: var(--sk-fill-9);
  }

  .nothing-title {
    font-size: var(--sk-fs-10);
    font-weight: 600;
    color: var(--sk-text-6);
  }

  .nothing-text {
    margin-top: 6px;
    font-size: var(--sk-fs-6);
    color: var(--sk-text-17);
  }
</style>
