import type { AgentModel } from '@skaro/timeline';
import { t, tn } from '@skaro/ui';
import type { AgentSettings, ChatSettings, ImportSource } from '../../../shared/ipc';
import type { ImportProps } from './import-props';
export function createImportController(p: ImportProps) {
  let open = $state(true);
  let sources = $state<ImportSource[]>([]);
  let hasCode = $state(false);
  let settings = $state.raw<ChatSettings | undefined>();
  let models = $state.raw<AgentModel[]>([]);
  let agentModal = $state(false);
  let over = $state(false);
  let busy = $state(false);
  let error = $state<string | undefined>();
  let modelRequest = 0;

  $effect(() => {
    if (!open) p.onclose();
  });

  // svelte-ignore state_referenced_locally
  void window.skaro
    .invoke('project.hasCode', p.projectId)
    .then((v) => (hasCode = v))
    .catch(() => undefined);
  // svelte-ignore state_referenced_locally
  void window.skaro
    .invoke('chats.defaults', p.projectId)
    .then((s) => (settings = s))
    .catch(() => (settings = { agent: 'claude-code' }));

  $effect(() => {
    const request = ++modelRequest;
    const agent = settings?.agent;
    if (!agent) return;
    void window.skaro
      .invoke('agents.models', agent, p.projectId)
      .then((list) => {
        if (request === modelRequest) models = list;
      })
      .catch(() => {
        if (request === modelRequest) models = [];
      });
  });

  const model = $derived(
    models.find((m) => m.id === settings?.model) ?? models.find((m) => m.isDefault),
  );
  const effort = $derived(
    settings?.effort ??
      model?.defaultEffort ??
      model?.efforts[Math.floor(model.efforts.length / 2)]?.id,
  );
  const missing = $derived(sources.filter((s) => s.missing));
  const read = $derived(sources.reduce((n, s) => n + (s.missing ? 0 : s.readable), 0));
  const unsupported = $derived(sources.reduce((n, s) => n + (s.missing ? 0 : s.unsupported), 0));
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- Local uniqueness index, rebuilt for each derivation.
  const formats = $derived([...new Set(sources.flatMap((s) => s.formats))].sort());
  const ok = $derived(sources.length > 0 && read > 0 && !missing.length && !busy);
  const modalSettings = $derived<AgentSettings | undefined>(
    settings && {
      agent: settings.agent,
      ...(settings.model ? { model: settings.model } : {}),
      ...(settings.effort ? { effort: settings.effort } : {}),
      permissionMode: settings.permissionMode ?? 'ask',
      planFirst: false,
      isolation: 'in-place',
    },
  );

  async function add(paths: string[]): Promise<void> {
    const fresh = paths.filter((p) => !sources.some((s) => s.path === p));
    if (!fresh.length) return;
    const found = await window.skaro.invoke('import.scan', fresh).catch(() => []);
    sources = [...sources, ...found];
  }

  async function pick(kind: 'folder' | 'files'): Promise<void> {
    const picked = await window.skaro.invoke('files.pick', kind).catch(() => []);
    await add(picked.map((p) => p.path));
  }

  function drop(e: DragEvent): void {
    e.preventDefault();
    over = false;
    const files = [...(e.dataTransfer?.files ?? [])];
    void add(files.map((f) => window.skaro.pathOf(f)).filter(Boolean));
  }

  async function start(): Promise<void> {
    if (!ok || !settings) return;
    busy = true;
    error = undefined;
    try {
      const chat = await window.skaro.invoke(
        'import.start',
        p.projectId,
        sources.map((s) => s.path),
        settings,
      );
      p.onstart(chat);
    } catch (e) {
      error = (e instanceof Error ? e.message : String(e)).replace(
        /^Error invoking remote method '[^']+': (Error: )?/,
        '',
      );
    } finally {
      busy = false;
    }
  }

  function count(s: ImportSource): string {
    return s.missing ? t('import.missing') : tn('import.files', s.files);
  }

  return {
    p,
    get open() {
      return open;
    },
    set open(value: typeof open) {
      open = value;
    },
    get sources() {
      return sources;
    },
    set sources(value: typeof sources) {
      sources = value;
    },
    get hasCode() {
      return hasCode;
    },
    get settings() {
      return settings;
    },
    set settings(value: typeof settings) {
      settings = value;
    },
    get models() {
      return models;
    },
    get agentModal() {
      return agentModal;
    },
    set agentModal(value: typeof agentModal) {
      agentModal = value;
    },
    get over() {
      return over;
    },
    set over(value: typeof over) {
      over = value;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    get effort() {
      return effort;
    },
    get missing() {
      return missing;
    },
    get read() {
      return read;
    },
    get unsupported() {
      return unsupported;
    },
    get formats() {
      return formats;
    },
    get ok() {
      return ok;
    },
    get modalSettings() {
      return modalSettings;
    },
    add,
    pick,
    drop,
    start,
    count,
  };
}
export type ImportController = ReturnType<typeof createImportController>;
