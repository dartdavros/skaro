import { useFeed } from './context.svelte';
const IMPORT_HEADS = ['Импортировать документацию', 'Import documentation'];
import type { UserMessageProps } from './user-message-props';
export function createUserMessageController(p: UserMessageProps) {
  const feed = useFeed();
  const queued = $derived(p.row.item.status === 'queued');
  let editing = $state(false);
  let draft = $state('');
  let confirm = $state<'rewind' | 'edit' | undefined>();
  let confirmOpen = $state(false);

  /**
   * The first message of an import chat (AgentChat mockup): "Импортировать документацию" and a
   * line per source in mono ("~/Docs/shop · 42 файла").
   */
  const importLines = $derived.by(() => {
    const [head, ...rest] = p.row.item.text.split('\n');
    if (!head || !IMPORT_HEADS.includes(head) || !rest.length) return undefined;
    return rest.every((l) => / · \d+ /.test(l)) ? { head, sources: rest } : undefined;
  });

  function startEdit(): void {
    draft = p.row.item.text;
    editing = true;
  }

  function run(): void {
    const kind = confirm;
    confirm = undefined;
    confirmOpen = false;
    if (kind === 'edit') {
      editing = false;
      void feed.rewind(p.row.item.id, { text: draft.trim() });
    } else {
      void feed.rewind(p.row.item.id);
    }
  }

  return {
    p,
    feed,
    get queued() {
      return queued;
    },
    get editing() {
      return editing;
    },
    set editing(value: typeof editing) {
      editing = value;
    },
    get draft() {
      return draft;
    },
    set draft(value: typeof draft) {
      draft = value;
    },
    get confirm() {
      return confirm;
    },
    set confirm(value: typeof confirm) {
      confirm = value;
      confirmOpen = value !== undefined;
    },
    get confirmOpen() {
      return confirmOpen;
    },
    set confirmOpen(value: boolean) {
      confirmOpen = value;
    },
    get importLines() {
      return importLines;
    },
    startEdit,
    run,
  };
}
export type UserMessageController = ReturnType<typeof createUserMessageController>;
