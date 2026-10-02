import type { AgentCommand } from '@skaro/timeline';
import type { MessageInput, PathSuggestion, PickedFile } from '../../../shared/ipc';
export function createComposerController(options: {
  commands: () => Promise<AgentCommand[]>;
  suggest: (query: string) => Promise<PathSuggestion[]>;
  onsend: (input: MessageInput) => Promise<void> | void;
}) {
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
        slash = await options.commands().catch(() => []);
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
    const rows = await options.suggest(query).catch(() => []);
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

  /** Puts text into the field and focuses it (chat start chips). */
  function prefill(value: string): void {
    text = value;
    textarea?.focus();
    queueMicrotask(() => {
      autosize();
      textarea?.setSelectionRange(text.length, text.length);
    });
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
      await options.onsend(input);
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

  return {
    get text() {
      return text;
    },
    set text(value: typeof text) {
      text = value;
    },
    get attachments() {
      return attachments;
    },
    set attachments(value: typeof attachments) {
      attachments = value;
    },
    get textarea() {
      return textarea;
    },
    set textarea(value: typeof textarea) {
      textarea = value;
    },
    get root() {
      return root;
    },
    set root(value: typeof root) {
      root = value;
    },
    get menu() {
      return menu;
    },
    set menu(value: typeof menu) {
      menu = value;
    },
    get atQuery() {
      return atQuery;
    },
    set atQuery(value: typeof atQuery) {
      atQuery = value;
    },
    get highlighted() {
      return highlighted;
    },
    set highlighted(value: typeof highlighted) {
      highlighted = value;
    },
    get sending() {
      return sending;
    },
    get has() {
      return has;
    },
    get slashRows() {
      return slashRows;
    },
    get atRows() {
      return atRows;
    },
    oninput,
    onkeydown,
    refreshAt,
    pickCommand,
    pickPath,
    prefill,
    attach,
    send,
  };
}

export type ComposerController = ReturnType<typeof createComposerController>;
