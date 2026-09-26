<script lang="ts">
  import type { AgentModel, InteractionAnswer, Item } from '@skaro/timeline';
  import { Icon, t, tn } from '@skaro/ui';
  import { onDestroy } from 'svelte';
  import type {
    AgentInfo,
    AgentSettings,
    ChatSettings,
    MessageInput,
    ProposalAction,
  } from '../../../shared/ipc';
  import { provideFeed } from '../feed/context.svelte';
  import Feed from '../feed/Feed.svelte';
  import { agentName, prettyModel } from '../feed/format';
  import ImageViewer from '../feed/ImageViewer.svelte';
  import PinnedZone from '../feed/PinnedZone.svelte';
  import '../feed/i18n';
  import AgentModal from '../task/AgentModal.svelte';
  import Composer from '../task/Composer.svelte';
  import SessionBanners from '../task/SessionBanners.svelte';
  import './i18n';
  import { ChatSession } from './session.svelte';

  type ProposalItem = Extract<Item, { kind: 'proposal' }>;

  /**
   * The open chat (AgentChat mockup): title and archive, the feed with proposal cards, the
   * composer; "Изменено в чате" on the right. Without `chatId` it is a new chat: the start
   * screen, and the first message creates the chat.
   */
  let {
    projectId,
    projectPath,
    agents,
    chatId,
    oncreated,
    onsection,
  }: {
    projectId: string;
    projectPath: string;
    agents: AgentInfo[];
    chatId: string | undefined;
    oncreated: (chatId: string) => void;
    onsection: (section: 'plan' | 'docs' | 'tasks') => void;
  } = $props();

  // The pane is keyed by chat.
  // svelte-ignore state_referenced_locally
  const session = chatId ? new ChatSession(projectId, chatId) : undefined;
  void session?.reload();
  onDestroy(() => session?.dispose());

  // Plain (not a proxy): it goes to the main process as is.
  let draft = $state.raw<ChatSettings | undefined>();
  // svelte-ignore state_referenced_locally
  if (!chatId) {
    void window.skaro
      .invoke('chats.defaults', projectId)
      .then((s) => (draft = s))
      .catch(() => (draft = { agent: 'claude-code' }));
  }

  let modal = $state(false);
  let viewer = $state<string | undefined>();
  let actionError = $state<string | undefined>();
  let composer: Composer | undefined = $state();

  const view = $derived(session?.view);
  const timeline = $derived(session?.timeline);
  const settings = $derived(view?.settings ?? draft);
  const archived = $derived(view?.chat.archived === true);
  const running = $derived(timeline !== undefined && timeline.status !== 'idle');
  const started = $derived((timeline?.items.length ?? 0) > 0);
  const agentInfo = $derived(agents.find((a) => a.id === settings?.agent));
  const title = $derived(view?.chat.title ?? t('chat.new'));
  const openQuestion = $derived(timeline?.interactions.find((i) => i.kind === 'question'));
  const openApproval = $derived(timeline?.interactions.find((i) => i.kind === 'approval'));
  // Model names come from the agent's own list ("Default (recommended)", "Opus 5").
  let models = $state.raw<AgentModel[]>([]);
  $effect(() => {
    const agent = settings?.agent;
    if (!agent || !agentInfo?.installed) return;
    void window.skaro
      .invoke('agents.models', agent, projectId)
      .then((list) => (models = list))
      .catch(() => (models = []));
  });
  const modelLabel = $derived.by(() => {
    const id = timeline?.session?.model || settings?.model;
    const known =
      models.find((m) => m.id === id) ?? (id ? undefined : models.find((m) => m.isDefault));
    if (known) return known.name;
    return id ? prettyModel(id) : agentName(settings?.agent ?? 'claude-code');
  });
  /** The modal's settings; the same object until they change, so an open modal keeps its draft. */
  const modalSettings = $derived<AgentSettings | undefined>(
    settings && {
      agent: settings.agent,
      ...(settings.model ? { model: settings.model } : {}),
      ...(settings.effort ? { effort: settings.effort } : {}),
      permissionMode: 'ask',
      planFirst: false,
      isolation: 'in-place',
    },
  );

  const proposals = $derived(
    (timeline?.items ?? []).filter((i): i is ProposalItem => i.kind === 'proposal'),
  );

  async function guard(action: () => Promise<unknown>): Promise<void> {
    actionError = undefined;
    try {
      await action();
    } catch (error) {
      actionError = cleanError(error);
      throw error;
    }
  }

  function cleanError(error: unknown): string {
    const text = error instanceof Error ? error.message : String(error);
    return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  }

  async function send(input: MessageInput): Promise<void> {
    if (!chatId) {
      if (!draft) return;
      const settings = draft;
      await guard(async () => {
        const chat = await window.skaro.invoke('chat.create', projectId, settings, input);
        oncreated(chat.id);
      });
      return;
    }
    // Text typed while a question or a permission is open answers it in the user's own words.
    if (openQuestion?.kind === 'question') {
      return respond(openQuestion.id, {
        kind: 'question',
        answers: Object.fromEntries(openQuestion.questions.map((q) => [q.id, [input.text]])),
      });
    }
    if (openApproval?.kind === 'approval') {
      return respond(openApproval.id, { kind: 'approval', choice: 'deny', message: input.text });
    }
    const id = chatId;
    await guard(() => window.skaro.invoke('chat.send', projectId, id, input));
  }

  function respond(id: string, answer: InteractionAnswer): Promise<void> {
    const chat = chatId;
    if (!chat) return Promise.resolve();
    return guard(() => window.skaro.invoke('chat.respond', projectId, chat, id, answer));
  }

  async function saveSettings(next: AgentSettings): Promise<void> {
    const value: ChatSettings = {
      agent: next.agent,
      ...(next.model ? { model: next.model } : {}),
      ...(next.effort ? { effort: next.effort } : {}),
    };
    if (!chatId) {
      draft = value;
      // A new chat starts with what was chosen last (main: ChatSessions.defaults).
      void window.skaro.invoke('app.setSetting', `chats.${projectId}.last`, value);
      return;
    }
    const chat = chatId;
    await guard(() => window.skaro.invoke('chat.setSettings', projectId, chat, value));
  }

  function setArchived(value: boolean): void {
    const chat = chatId;
    if (chat)
      void guard(() => window.skaro.invoke('chat.archive', projectId, chat, value)).catch(
        () => undefined,
      );
  }

  function chip(kind: 'idea' | 'spec' | 'code'): void {
    if (kind === 'code') {
      void send({ text: t('chat.chip.code.text') }).catch(() => undefined);
      return;
    }
    composer?.prefill(t(`chat.chip.${kind}.text`));
    if (kind === 'spec') void composer?.attach('files');
  }

  provideFeed({
    get cwd() {
      return projectPath;
    },
    get interactive() {
      return !archived;
    },
    openPath: (path) =>
      void guard(() => window.skaro.invoke('files.open', projectId, '', path)).catch(
        () => undefined,
      ),
    existing: (paths) => window.skaro.invoke('files.exist', projectId, '', paths).catch(() => []),
    openExternal: (url) => void window.skaro.invoke('shell.openExternal', url),
    viewImage: (src) => (viewer = src),
    stopBackground: () => undefined,
    respond,
    merge: () => Promise.resolve(),
    rewind: (itemId, resend) => {
      const chat = chatId;
      if (!chat) return Promise.resolve();
      return guard(() => window.skaro.invoke('chat.rewind', projectId, chat, itemId, resend));
    },
    restart: () => void send({ text: t('chat.continue') }).catch(() => undefined),
    proposal: (itemId: string, action: ProposalAction) => {
      const chat = chatId;
      if (!chat) return Promise.resolve();
      return guard(() => window.skaro.invoke('chat.proposal', projectId, chat, itemId, action));
    },
    openSection: (section) => onsection(section),
  });

  /** "Изменено в чате": what each proposal is and where it stands. */
  function changed(item: ProposalItem): {
    icon: 'file' | 'adr' | 'milestone';
    title: string;
    note: string;
    pending: boolean;
  } {
    const p = item.proposal;
    const pending = item.state === 'pending';
    const settled =
      item.state === 'rejected'
        ? t('changed.rejected')
        : item.state === 'reverted'
          ? t('changed.reverted')
          : undefined;
    switch (p.type) {
      case 'doc':
        return {
          icon: 'file',
          title: p.path,
          pending,
          note: pending
            ? t('changed.pending')
            : (settled ??
              (p.before === undefined ? t('changed.doc.created') : t('changed.doc.updated'))),
        };
      case 'task':
        return {
          icon: 'file',
          title: `${p.id} · ${p.title}`,
          pending,
          note: pending ? t('changed.pending') : (settled ?? t('changed.task.updated')),
        };
      case 'adr':
        return {
          icon: 'adr',
          title: `ADR-${item.result?.adr?.id ?? p.id} · ${item.result?.adr?.title ?? p.title}`,
          pending,
          note: pending ? t('changed.pending') : (settled ?? t('changed.adr.accepted')),
        };
      case 'plan':
        return {
          icon: 'milestone',
          title: p.milestone?.isNew
            ? `${item.result?.milestone?.id ?? p.milestone.id} · ${p.milestone.title}`
            : `${p.milestone ? `${p.milestone.id} · ` : ''}${tn('proposal.tasks', p.tasks.length)}`,
          pending,
          note: pending
            ? t('changed.pending')
            : (settled ??
              (p.milestone?.isNew ? t('changed.plan.milestone') : t('changed.plan.tasks'))),
        };
    }
  }

  function reveal(item: ProposalItem): void {
    document
      .getElementById(`proposal-${item.id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
</script>

<div class="main">
  <div class="head">
    <span class="title">{title}</span>
    {#if view && !archived}
      <button
        type="button"
        class="archive"
        data-tip={t('chat.archive')}
        aria-label={t('chat.archive')}
        onclick={() => setArchived(true)}
      >
        <Icon name="archive" size={15} stroke={1.8} />
      </button>
    {/if}
  </div>

  <div class="banners">
    <SessionBanners
      agent={agentInfo}
      limits={timeline?.limits}
      error={actionError ?? session?.error}
      ondismiss={() => (actionError = undefined)}
    />
  </div>

  {#if timeline && started}
    <Feed {timeline} cwd={projectPath} mergeMessage="" />
  {:else if running || (view && !archived)}
    <!-- The first message is on its way: the agent is starting. -->
    <div class="empty"><span class="fd-pulse"></span></div>
  {:else if session?.error && !view}
    <div class="empty"><span class="empty-text">{t('chat.notFound')}</span></div>
  {:else if !chatId}
    <div class="empty">
      <span class="empty-title">{t('chat.empty.title')}</span>
      <span class="empty-text">{t('chat.empty.text')}</span>
      <div class="chips">
        {#each ['idea', 'spec', 'code'] as const as kind (kind)}
          <button type="button" class="chip" onclick={() => chip(kind)}
            >{t(`chat.chip.${kind}`)}</button
          >
        {/each}
      </div>
    </div>
  {:else}
    <div class="empty"></div>
  {/if}

  {#if archived}
    <div class="bottom">
      <div class="archived">
        <Icon name="archive" size={14} stroke={1.8} color="var(--sk-text-22)" />
        <span class="archived-text">{t('chat.archived')}</span>
        <button type="button" class="restore" onclick={() => setArchived(false)}
          >{t('chat.restore')}</button
        >
      </div>
    </div>
  {:else if settings}
    <div class="bottom">
      {#if timeline}<PinnedZone {timeline} />{/if}
      <Composer
        bind:this={composer}
        placeholder={t('chat.placeholder')}
        {running}
        agent={agentInfo?.id ?? settings.agent}
        model={modelLabel}
        modelTip={t('chat.model.tip')}
        {...timeline?.usage?.contextUsedPct !== undefined
          ? { contextPct: timeline.usage.contextUsedPct }
          : {}}
        planFirst={false}
        commands={() => window.skaro.invoke('agents.commands', settings.agent, projectId)}
        suggest={(q) => window.skaro.invoke('files.suggest', projectId, '', q)}
        onsend={send}
        onstop={() => {
          const chat = chatId;
          if (chat) void window.skaro.invoke('chat.interrupt', projectId, chat);
        }}
        onmodel={() => (modal = true)}
      />
    </div>
  {/if}
</div>

<div class="changed">
  <span class="sk-label changed-label">{t('chat.changed')}</span>
  <div class="changed-list">
    {#each proposals as item (item.id)}
      {@const c = changed(item)}
      <button
        type="button"
        class="changed-row"
        data-tip={c.pending ? t('chat.changed.pending.tip') : t('chat.changed.open.tip')}
        onclick={() => reveal(item)}
      >
        <span class="changed-icon"><Icon name={c.icon} size={13} stroke={1.8} /></span>
        <span class="changed-texts">
          <span class="changed-title">{c.title}</span>
          <span class="changed-note" class:pending={c.pending}>{c.note}</span>
        </span>
      </button>
    {/each}
  </div>
</div>

{#if modalSettings}
  <AgentModal
    bind:open={modal}
    kind="chat"
    {projectId}
    settings={modalSettings}
    {agents}
    locked={chatId !== undefined}
    onsave={saveSettings}
  />
{/if}
<ImageViewer bind:src={viewer} />

<style>
  .main {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 4px 14px 0;
  }

  .title {
    flex: 1;
    min-width: 0;
    font-size: var(--sk-fs-7);
    font-weight: 600;
    color: var(--sk-text-7);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .archive {
    flex: none;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--sk-text-23);
    cursor: pointer;
  }

  .archive:hover {
    background: var(--sk-fill-15);
    color: var(--sk-text-6);
  }

  .banners {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 14px 0;
  }

  .banners:empty {
    display: none;
  }

  .empty {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    padding: 20px;
  }

  .empty-title {
    font-size: var(--sk-fs-8);
    font-weight: 600;
    color: var(--sk-text-13);
  }

  .empty-text {
    max-width: 340px;
    font-size: var(--sk-fs-5);
    line-height: 1.5;
    color: var(--sk-text-21);
    text-align: center;
    text-wrap: pretty;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 7px;
  }

  .chip {
    height: 29px;
    padding: 0 13px;
    border: none;
    border-radius: 8px;
    background: var(--sk-fill-13);
    color: var(--sk-text-7);
    font: inherit;
    font-size: var(--sk-fs-5);
    font-weight: 600;
    cursor: pointer;
  }

  .chip:hover {
    background: var(--sk-fill-20);
    color: var(--sk-text-2);
  }

  .bottom {
    flex: none;
    padding: 0 14px 12px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .archived {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 11px;
    background: var(--sk-fill-26);
  }

  .archived-text {
    flex: 1;
    font-size: var(--sk-fs-5);
    color: var(--sk-text-19);
  }

  .restore {
    flex: none;
    height: 28px;
    padding: 0 12px;
    border: none;
    border-radius: 7px;
    background: var(--sk-fill-23);
    color: var(--sk-text-7);
    font: inherit;
    font-size: var(--sk-fs-4);
    font-weight: 600;
    cursor: pointer;
  }

  .restore:hover {
    background: var(--sk-fill-29);
    color: var(--sk-text-2);
  }

  .changed {
    flex: none;
    width: 216px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 9px;
    padding: 12px 14px 12px 8px;
  }

  .changed-label {
    flex: none;
  }

  .changed-list {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .changed-row {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 8px 9px;
    border: none;
    border-radius: 8px;
    background: transparent;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .changed-row:hover {
    background: var(--sk-fill-13);
  }

  .changed-icon {
    flex: none;
    margin-top: 1px;
    display: inline-flex;
    color: var(--sk-text-23);
  }

  .changed-texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .changed-title {
    font-size: var(--sk-fs-4);
    color: var(--sk-text-7);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .changed-note {
    font-size: var(--sk-fs-2);
    color: var(--sk-text-19);
  }

  .changed-note.pending {
    color: var(--sk-orange-1);
  }
</style>
