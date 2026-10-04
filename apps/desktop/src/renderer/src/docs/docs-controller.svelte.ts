import { onDestroy } from 'svelte';
import { ProjectDocs } from './data.svelte';
import type DocPage from './DocPage.svelte';
import { adrLink, BRIEF, specLink } from './model';
import { renderDoc } from './render';
import { createTreePreferences } from './tree-preferences.svelte';
import type { DocsProps } from './docs-props';

export function createDocsController(p: DocsProps) {
  // The screen is keyed by project.
  // svelte-ignore state_referenced_locally
  const docs = new ProjectDocs(p.projectId);
  onDestroy(() => docs.dispose());

  const tree = createTreePreferences();
  let modal = $state<'new' | 'spec' | 'leave' | undefined>();
  /** The project has code of its own: the empty brief and architecture are optional (D-32). */
  let hasCode = $state(false);
  // svelte-ignore state_referenced_locally
  void window.skaro
    .invoke('project.hasCode', p.projectId)
    .then((v) => (hasCode = v))
    .catch(() => undefined);
  /** Where to go after "Отменить правки": a document, or just out of the editor. */
  let pending = $state<string | undefined>();
  let page: DocPage | undefined = $state();
  let now = $state(Date.now());

  const doc = $derived(docs.current);
  const rendered = $derived(renderDoc(docs.text));
  const missing = $derived(doc ? !docs.exists(doc.path) : false);
  const specTasks = $derived(
    doc?.spec
      ? p.tasks.tasks
          .filter((x) => x.spec?.id === doc.spec!.id && !x.archived)
          .map((x) => ({ id: x.id, title: x.title, status: x.status }))
      : [],
  );
  const nextSpec = $derived(
    `SPEC-${String(Math.max(0, ...docs.entries.map((d) => Number(d.spec?.id ?? 0))) + 1).padStart(
      4,
      '0',
    )}`,
  );

  $effect(() => {
    const timer = setInterval(() => (now = Date.now()), 60_000);
    return () => clearInterval(timer);
  });

  // A document asked for from outside (a task's specification) is shown once it is listed.
  let opened: string | undefined;
  $effect(() => {
    if (!docs.loaded || !p.open || opened === p.open || !docs.exists(p.open)) return;
    opened = p.open;
    void docs.open(p.open);
  });

  // The first document shown is the architecture, or the brief when there is none.
  $effect(() => {
    if (!docs.loaded || (p.open && p.open !== opened)) return;
    if (!docs.exists(docs.selected) && docs.exists(BRIEF) && docs.selected !== BRIEF) {
      void docs.open(BRIEF);
    }
  });

  function select(path: string): void {
    if (docs.dirty) {
      pending = path;
      modal = 'leave';
      return;
    }
    void docs.open(path).then(() => page?.top());
  }

  function cancel(): void {
    if (docs.dirty) {
      pending = undefined;
      modal = 'leave';
    } else docs.cancel();
  }

  function discard(): void {
    modal = undefined;
    docs.cancel();
    if (pending) select(pending);
    pending = undefined;
  }

  function link(href: string): void {
    const adr = adrLink(href);
    const spec = specLink(href);
    const target = adr
      ? docs.entries.find((d) => d.adr?.id === adr)
      : spec
        ? docs.entries.find((d) => d.spec?.id === spec)
        : undefined;
    if (target) select(target.path);
    else if (/^https?:\/\//i.test(href)) void window.skaro.invoke('shell.openExternal', href);
  }

  async function create(name: string): Promise<void> {
    modal = undefined;
    const entry = await window.skaro.invoke('docs.create', p.projectId, name);
    await docs.reload();
    await docs.open(entry.path);
    docs.edit('## ');
  }

  async function createSpec(title: string): Promise<void> {
    modal = undefined;
    const entry = await window.skaro.invoke('docs.createSpec', p.projectId, title);
    await docs.reload();
    await docs.open(entry.path);
  }

  function keys(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && docs.editing) {
      e.preventDefault();
      void docs.save();
    }
  }

  return {
    p,
    tree,
    get docs() {
      return docs;
    },
    get modal() {
      return modal;
    },
    set modal(value: typeof modal) {
      modal = value;
    },
    get hasCode() {
      return hasCode;
    },
    get page() {
      return page;
    },
    set page(value: typeof page) {
      page = value;
    },
    get now() {
      return now;
    },
    get doc() {
      return doc;
    },
    get rendered() {
      return rendered;
    },
    get missing() {
      return missing;
    },
    get specTasks() {
      return specTasks;
    },
    get nextSpec() {
      return nextSpec;
    },
    select,
    cancel,
    discard,
    link,
    create,
    createSpec,
    keys,
  };
}

export type DocsController = ReturnType<typeof createDocsController>;
