import type { FolderInfo } from '../../../shared/ipc';
import type { NewProjectContext } from './new-project-props';
export function createNewProjectController(p: NewProjectContext) {
  let mode = $state<'existing' | 'create'>('existing');
  let folder = $state<FolderInfo | undefined>();
  let parent = $state('');
  let name = $state('');
  let busy = $state(false);
  let error = $state<string | undefined>();

  $effect(() => {
    if (!p.open) return;
    mode = 'existing';
    folder = undefined;
    name = '';
    error = undefined;
    void window.skaro.invoke('projects.defaultParent').then((p) => (parent = p));
  });

  const ready = $derived(
    mode === 'existing' ? folder?.exists === true : parent !== '' && name.trim() !== '',
  );

  async function browse(): Promise<void> {
    error = undefined;
    const picked = await window.skaro.invoke(
      'projects.pickFolder',
      mode === 'create' ? parent : (folder?.path ?? parent),
    );
    if (!picked) return;
    if (mode === 'create') parent = picked;
    else folder = await window.skaro.invoke('projects.inspect', picked);
  }

  async function submit(): Promise<void> {
    if (!ready || busy) return;
    busy = true;
    error = undefined;
    try {
      const project =
        mode === 'existing'
          ? await window.skaro.invoke('projects.add', folder!.path)
          : await window.skaro.invoke('projects.create', parent, name.trim());
      p.open = false;
      p.oncreated(project);
    } catch (e) {
      const text = e instanceof Error ? e.message : String(e);
      error = text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    } finally {
      busy = false;
    }
  }

  return {
    p,
    get mode() {
      return mode;
    },
    set mode(value: typeof mode) {
      mode = value;
    },
    get folder() {
      return folder;
    },
    get parent() {
      return parent;
    },
    get name() {
      return name;
    },
    set name(value: typeof name) {
      name = value;
    },
    get busy() {
      return busy;
    },
    get error() {
      return error;
    },
    get ready() {
      return ready;
    },
    browse,
    submit,
  };
}
export type NewProjectController = ReturnType<typeof createNewProjectController>;
