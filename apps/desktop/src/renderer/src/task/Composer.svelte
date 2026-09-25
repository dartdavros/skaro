<script lang="ts">
  import type { AgentCommand, PermissionMode } from '@skaro/timeline';
  import { AgentLogo, Icon, t } from '@skaro/ui';
  import type { AgentId, MessageInput, PathSuggestion, PickedFile } from '../../../shared/ipc';
  import { localImageUrl } from '../feed/format';

  /**
   * Composer (Composer mockup, "Лента агента" 6 and 10): text, "/" commands, "@" files, attachments,
   * permission and plan pills, context fill, model button, send / queue / stop.
   */
  let {
    placeholder,
    running,
    agent,
    model,
    contextPct,
    permissionMode,
    planFirst,
    imagesSupported = true,
    commands,
    suggest,
    onsend,
    onstop,
    onmodel,
    onpermission,
  }: {
    placeholder: string;
    running: boolean;
    agent: AgentId;
    model: string;
    contextPct?: number;
    permissionMode?: PermissionMode;
    planFirst: boolean;
    imagesSupported?: boolean;
    commands: () => Promise<AgentCommand[]>;
    suggest: (query: string) => Promise<PathSuggestion[]>;
    onsend: (input: MessageInput) => Promise<void> | void;
    onstop: () => void;
    onmodel: () => void;
    onpermission?: (mode: PermissionMode) => void;
  } = $props();

  let text = $state('');
  let attachments = $state<PickedFile[]>([]);
  let textarea: HTMLTextAreaElement | undefined = $state();
  let root: HTMLDivElement | undefined = $state();
  let menu = $state<'slash' | 'at' | 'attach' | 'perm' | undefined>();
  let slash = $state<AgentCommand[]>([]);
  let atQuery = $state('');
  let atRows = $state<PathSuggestion[]>([]);
  let highlighted = $state(0);
  let sending = $state(false);

  const has = $derived(text.trim().length > 0 || attachments.length > 0);
  const slashRows = $derived.by(() => {
    const q = text.slice(1).toLowerCase();
    return slash.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 40);
  });

  const PERMS: { id: PermissionMode; warn?: boolean }[] = [
    { id: 'ask' },
    { id: 'auto' },
    { id: 'full', warn: true },
  ];

  function autosize(): void {
    if (!textarea) return;
    textarea.style.height = 'auto';
    const max = 21 * 7 + 4;
    textarea.style.height = `${Math.min(Math.max(textarea.scrollHeight, 48), max)}px`;
    textarea.style.overflowY = textarea.scrollHeight > max ? 'auto' : 'hidden';
  }

  async function oninput(): Promise<void> {
    autosize();
    if (text.startsWith('/') && !text.includes(' ') && !text.includes('\n')) {
      if (menu !== 'slash') {
        menu = 'slash';
        highlighted = 0;
        slash = await commands().catch(() => []);
      }
      return;
    }
    if (menu === 'slash') menu = undefined;
    // "@" typed at the end opens the file menu.
    if (/(^|\s)@$/.test(text)) {
      text = text.slice(0, -1);
      openAt();
    }
  }

  function openAt(): void {
    menu = 'at';
    atQuery = '';
    highlighted = 0;
    void refreshAt();
  }

  async function refreshAt(): Promise<void> {
    const query = atQuery;
    const rows = await suggest(query).catch(() => []);
    if (query === atQuery) atRows = rows;
  }

  function pickCommand(command: AgentCommand): void {
    text = `/${command.name} `;
    menu = undefined;
    textarea?.focus();
  }

  function pickPath(row: PathSuggestion): void {
    if (!attachments.some((a) => a.path === row.path)) {
      attachments = [
        ...attachments,
        { path: row.path, kind: row.kind === 'folder' ? 'folder' : 'file' },
      ];
    }
    menu = undefined;
    textarea?.focus();
  }

  async function attach(kind: 'files' | 'folder'): Promise<void> {
    menu = undefined;
    const picked = await window.skaro.invoke('files.pick', kind);
    attachments = [
      ...attachments,
      ...picked.filter((p) => !attachments.some((a) => a.path === p.path)),
    ];
  }

  async function send(): Promise<void> {
    if (!has || sending) return;
    const files = attachments.filter((a) => a.kind !== 'image');
    const images = attachments.filter((a) => a.kind === 'image').map((a) => a.path);
    // Files and folders are references to paths, not uploads (agent-output.md 5.1).
    const refs = files.map((f) => `@${f.path}`).join(' ');
    const input: MessageInput = {
      text: [refs, text.trim()].filter(Boolean).join('\n'),
      ...(images.length ? { images } : {}),
    };
    sending = true;
    try {
      await onsend(input);
      text = '';
      attachments = [];
      menu = undefined;
      queueMicrotask(autosize);
    } finally {
      sending = false;
    }
  }

  function onkeydown(event: KeyboardEvent): void {
    const rows = menu === 'slash' ? slashRows.length : menu === 'at' ? atRows.length : 0;
    if (rows && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault();
      highlighted = (highlighted + (event.key === 'ArrowDown' ? 1 : rows - 1)) % rows;
      return;
    }
    if (rows && (event.key === 'Enter' || event.key === 'Tab')) {
      event.preventDefault();
      if (menu === 'slash') pickCommand(slashRows[highlighted]!);
      else pickPath(atRows[highlighted]!);
      return;
    }
    if (event.key === 'Escape' && menu) {
      menu = undefined;
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void send();
    }
  }

  $effect(() => {
    if (!menu) return;
    const outside = (e: PointerEvent) => {
      if (root && !root.contains(e.target as Node)) menu = undefined;
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  });

  const ctxColor = $derived((contextPct ?? 0) >= 85 ? '#e0a33c' : '#2a52be');
  const ctxDash = $derived(`${((37.7 * (contextPct ?? 0)) / 100).toFixed(1)} 37.7`);
</script>

<div class="composer" bind:this={root}>
  {#if menu === 'slash'}
    <div class="menu">
      {#each slashRows as command, i (command.name)}
        <button
          type="button"
          class="slash-row"
          class:hl={i === highlighted}
          onclick={() => pickCommand(command)}
          onpointerenter={() => (highlighted = i)}
        >
          <span class="cmd">/{command.name}</span>
          <span class="note">{command.description}</span>
        </button>
      {:else}
        <div class="empty">{t('composer.slash.empty')}</div>
      {/each}
    </div>
  {:else if menu === 'at'}
    <div class="menu at">
      <div class="search">
        <Icon name="search" size={14} stroke={2} color="#989898" />
        <!-- svelte-ignore a11y_autofocus -->
        <input
          type="text"
          placeholder={t('composer.at.placeholder')}
          bind:value={atQuery}
          autofocus
          oninput={() => {
            highlighted = 0;
            void refreshAt();
          }}
          {onkeydown}
        />
      </div>
      <div class="at-rows">
        {#each atRows as row, i (row.path)}
          <button
            type="button"
            class="at-row"
            class:hl={i === highlighted}
            onclick={() => pickPath(row)}
            onpointerenter={() => (highlighted = i)}
          >
            <Icon
              name={row.kind === 'folder' ? 'folderOpen' : 'file'}
              size={13}
              stroke={1.9}
              color="#8a8a8a"
            />
            <span>{row.path}</span>
          </button>
        {:else}
          <div class="empty">{t('composer.at.empty')}</div>
        {/each}
      </div>
    </div>
  {/if}

  {#if attachments.length}
    <div class="attachments">
      {#each attachments.filter((a) => a.kind === 'image') as image (image.path)}
        <div
          class="thumb"
          data-tip={imagesSupported
            ? image.path.split(/[\\/]/).pop()
            : t('composer.image.noSupport')}
        >
          <img src={localImageUrl(image.path)} alt="" />
          {#if !imagesSupported}
            <span class="warn"><Icon name="warning" size={10} stroke={2.6} /></span>
          {/if}
          <button
            type="button"
            class="remove-thumb"
            data-tip={t('composer.chip.remove')}
            aria-label={t('composer.chip.remove')}
            onclick={() => (attachments = attachments.filter((a) => a !== image))}
          >
            <Icon name="close" size={9} stroke={3} />
          </button>
        </div>
      {/each}
      {#each attachments.filter((a) => a.kind !== 'image') as file (file.path)}
        <span
          class="chip"
          data-tip={file.kind === 'folder' ? t('composer.chip.folder') : t('composer.chip.file')}
        >
          <Icon
            name={file.kind === 'folder' ? 'folderOpen' : 'file'}
            size={13}
            stroke={1.9}
            color="#8a8a8a"
          />
          <span class="chip-label"
            >{file.path.split(/[\\/]/).filter(Boolean).pop()}{file.kind === 'folder'
              ? '/'
              : ''}</span
          >
          <button
            type="button"
            class="chip-remove"
            data-tip={t('composer.chip.remove')}
            aria-label={t('composer.chip.remove')}
            onclick={() => (attachments = attachments.filter((a) => a !== file))}
          >
            <Icon name="close" size={10} stroke={2.8} />
          </button>
        </span>
      {/each}
    </div>
  {/if}

  <textarea
    bind:this={textarea}
    bind:value={text}
    rows="2"
    {placeholder}
    oninput={() => void oninput()}
    {onkeydown}></textarea>

  <div class="bar">
    <div class="pop-anchor">
      <button
        type="button"
        class="round"
        class:on={menu === 'attach'}
        data-tip={t('composer.attach')}
        aria-label={t('composer.attach')}
        onclick={() => (menu = menu === 'attach' ? undefined : 'attach')}
      >
        <Icon name="plus" size={15} stroke={2.6} />
      </button>
      {#if menu === 'attach'}
        <div class="pop attach">
          <button type="button" class="pop-row" onclick={() => void attach('files')}>
            <Icon name="file" size={14} stroke={1.8} color="#8a8a8a" />{t('composer.attach.file')}
          </button>
          <button type="button" class="pop-row" onclick={() => void attach('folder')}>
            <Icon name="folderOpen" size={14} stroke={1.8} color="#8a8a8a" />{t(
              'composer.attach.folder',
            )}
          </button>
        </div>
      {/if}
    </div>

    {#if permissionMode && onpermission}
      <div class="pop-anchor">
        <button
          type="button"
          class="pill"
          class:warn={permissionMode === 'full'}
          class:on={menu === 'perm'}
          data-tip={t('composer.perm.tip')}
          onclick={() => (menu = menu === 'perm' ? undefined : 'perm')}
        >
          <Icon name="shield" size={13} stroke={2} />
          {t(`composer.perm.${permissionMode}`)}
          <Icon name="chevronDown" size={11} stroke={2.4} />
        </button>
        {#if menu === 'perm'}
          <div class="pop perm">
            {#each PERMS as p (p.id)}
              {@const on = p.id === permissionMode}
              <button
                type="button"
                class="perm-row"
                class:on
                onclick={() => {
                  menu = undefined;
                  if (!on) onpermission(p.id);
                }}
              >
                <span
                  class="check"
                  style="color: {on ? (p.warn ? '#e0a33c' : '#2a52be') : 'transparent'}"
                >
                  <Icon name="check" size={13} stroke={2.6} />
                </span>
                <span class="texts">
                  <span class="label" class:warn={on && p.warn}>{t(`composer.perm.${p.id}`)}</span>
                  <span class="note">{t(`composer.perm.${p.id}.note`)}</span>
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    {#if planFirst}
      <span class="pill static" data-tip={t('composer.plan.tip')}>
        <Icon name="plan" size={13} stroke={2} />{t('composer.plan')}
      </span>
    {/if}

    <span class="spacer"></span>

    {#if contextPct !== undefined}
      <span class="ctx" data-tip={t('composer.ctx.tip', { n: Math.round(contextPct) })}>
        <svg width="16" height="16" viewBox="0 0 16 16" style="transform: rotate(-90deg)">
          <circle cx="8" cy="8" r="6" fill="none" stroke="#454545" stroke-width="2.2" />
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke={ctxColor}
            stroke-width="2.2"
            stroke-linecap="round"
            stroke-dasharray={ctxDash}
          />
        </svg>
      </span>
    {/if}

    <button type="button" class="model" data-tip={t('composer.model.tip')} onclick={onmodel}>
      <AgentLogo {agent} size={15} />
      {model}
      <Icon name="chevronDown" size={11} stroke={2.4} />
    </button>

    {#if !running || has}
      <button
        type="button"
        class="send"
        class:ready={has}
        disabled={!has || sending}
        data-tip={running ? t('composer.queue') : t('composer.send')}
        aria-label={running ? t('composer.queue') : t('composer.send')}
        onclick={() => void send()}
      >
        <Icon name="send" size={14} stroke={2.3} />
      </button>
    {/if}
    {#if running}
      <button
        type="button"
        class="stop"
        data-tip={t('composer.stop')}
        aria-label={t('composer.stop')}
        onclick={onstop}
      >
        <svg width="16" height="16" viewBox="0 0 16 16"
          ><circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.5"
          ></circle><rect x="5.25" y="5.25" width="5.5" height="5.5" rx="1" fill="currentColor"
          ></rect></svg
        >
      </button>
    {/if}
  </div>
</div>

<style>
  .composer {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 10px 8px 8px;
    border-radius: 14px;
    background: #2b2b2b;
  }

  textarea {
    width: 100%;
    box-sizing: border-box;
    height: 48px;
    overflow-y: hidden;
    padding: 0 6px;
    border: none;
    background: transparent;
    color: #d5d5d5;
    font: inherit;
    font-size: 14px;
    line-height: 1.5;
    resize: none;
    outline: none;
  }

  textarea::placeholder {
    color: #7d7d7d;
  }

  .bar {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .spacer {
    flex: 1;
  }

  .pop-anchor {
    position: relative;
    flex: none;
  }

  .round {
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #8a8a8a;
    cursor: pointer;
    padding: 0;
  }

  .round:hover,
  .round.on {
    background: #383838;
    color: #e2e2e2;
  }

  .pill {
    flex: none;
    height: 28px;
    padding: 0 10px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: #b1b1b1;
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .pill:hover,
  .pill.on {
    background: #383838;
  }

  .pill.warn {
    background: rgba(224, 163, 60, 0.1);
    color: #e0a33c;
  }

  .pill.static {
    background: #383838;
    color: #d5d5d5;
    cursor: default;
  }

  .ctx {
    flex: none;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
  }

  .ctx:hover {
    background: #383838;
  }

  .model {
    flex: none;
    height: 28px;
    padding: 0 10px 0 9px;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    border: none;
    border-radius: 999px;
    background: transparent;
    color: #b1b1b1;
    font: inherit;
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }

  .model:hover {
    background: #383838;
    color: #e2e2e2;
  }

  .send {
    flex: none;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: #383838;
    color: #7d7d7d;
    cursor: default;
    padding: 0;
  }

  .send.ready {
    background: #2a52be;
    color: #fff;
    cursor: pointer;
  }

  .send.ready:hover {
    background: #3461d6;
  }

  .stop {
    flex: none;
    width: 28px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #d5d5d5;
    cursor: pointer;
    padding: 0;
  }

  .stop:hover {
    background: #383838;
    color: #fff;
  }

  .menu {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 6px);
    z-index: 40;
    max-height: 260px;
    overflow: auto;
    padding: 5px;
    border-radius: 10px;
    background: #242424;
    box-shadow: 0 16px 38px rgba(0, 0, 0, 0.55);
    display: flex;
    flex-direction: column;
    gap: 1px;
    animation: skIn 0.14s ease-out;
  }

  .menu.at {
    overflow: visible;
    gap: 4px;
  }

  .slash-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 7px 9px;
    border: none;
    border-radius: 7px;
    background: transparent;
    cursor: pointer;
    text-align: left;
    font: inherit;
  }

  .slash-row.hl,
  .at-row.hl {
    background: #2d2d2d;
  }

  .slash-row .cmd {
    flex: none;
    font-family: var(--sk-mono);
    font-size: 12px;
    color: #e8875b;
  }

  .slash-row .note {
    flex: 1;
    min-width: 0;
    font-size: 12px;
    color: #8a8a8a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .search {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search :global(svg) {
    position: absolute;
    left: 10px;
  }

  .search input {
    width: 100%;
    height: 32px;
    padding: 0 10px 0 31px;
    border: none;
    border-radius: 8px;
    background: #121212;
    color: #ededed;
    font-family: var(--sk-mono);
    font-size: 12px;
    outline: none;
  }

  .search input:focus {
    box-shadow: inset 0 0 0 1px #2a52be;
  }

  .at-rows {
    max-height: 210px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .at-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 9px;
    border: none;
    border-radius: 7px;
    background: transparent;
    cursor: pointer;
    text-align: left;
    font-family: var(--sk-mono);
    font-size: 12px;
    color: #c8c8c8;
  }

  .at-row span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    padding: 8px 9px;
    font-size: 12px;
    color: #7d7d7d;
  }

  .pop {
    position: absolute;
    bottom: 34px;
    left: 0;
    z-index: 40;
    padding: 5px;
    border-radius: 10px;
    background: #242424;
    box-shadow: 0 16px 38px rgba(0, 0, 0, 0.55);
    display: flex;
    flex-direction: column;
    gap: 1px;
    animation: skIn 0.14s ease-out;
  }

  .pop.attach {
    width: 208px;
  }

  .pop.perm {
    width: 280px;
  }

  .pop-row {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 9px;
    border: none;
    border-radius: 7px;
    background: transparent;
    font: inherit;
    font-size: 12.5px;
    color: #c8c8c8;
    cursor: pointer;
    text-align: left;
  }

  .pop-row:hover,
  .perm-row:hover {
    background: #2d2d2d;
  }

  .perm-row {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    padding: 8px 9px;
    border: none;
    border-radius: 7px;
    background: transparent;
    cursor: pointer;
    text-align: left;
    font: inherit;
  }

  .perm-row.on {
    background: #2b2b2b;
  }

  .perm-row .check {
    flex: none;
    margin-top: 2px;
    width: 13px;
    display: inline-flex;
  }

  .perm-row .texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .perm-row .label {
    font-size: 12.5px;
    font-weight: 600;
    color: #d5d5d5;
  }

  .perm-row .label.warn {
    color: #e0a33c;
  }

  .perm-row .note {
    font-size: 11px;
    line-height: 1.4;
    color: #7d7d7d;
  }

  .attachments {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    padding: 2px 2px 8px;
  }

  .thumb {
    position: relative;
    flex: none;
    width: 40px;
    height: 40px;
    border-radius: 8px;
    background: #383838;
  }

  .thumb img {
    width: 40px;
    height: 40px;
    border-radius: 8px;
    object-fit: cover;
    display: block;
  }

  .thumb .warn {
    position: absolute;
    left: -4px;
    bottom: -4px;
    width: 17px;
    height: 17px;
    border-radius: 50%;
    background: #121212;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: #e0a33c;
  }

  .remove-thumb {
    position: absolute;
    top: -5px;
    right: -5px;
    width: 17px;
    height: 17px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: #121212;
    color: #a6a6a6;
    cursor: pointer;
  }

  .remove-thumb:hover {
    color: #ededed;
  }

  .chip {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 5px 0 10px;
    border-radius: 999px;
    background: #383838;
    color: #c8c8c8;
  }

  .chip-label {
    font-family: var(--sk-mono);
    font-size: 11.5px;
    white-space: nowrap;
  }

  .chip-remove {
    flex: none;
    width: 18px;
    height: 18px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: transparent;
    color: #8a8a8a;
    cursor: pointer;
  }

  .chip-remove:hover {
    background: #454545;
    color: #ededed;
  }
</style>
