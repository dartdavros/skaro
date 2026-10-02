import { t } from '@skaro/ui';
import type { ProjectSettings } from '../../../shared/ipc';
import type { ProjectParamsProps } from './project-params-props';
export function createProjectParamsController(p: ProjectParamsProps) {
  let settings = $state<ProjectSettings | undefined>();
  /** The logo could not be taken: too large or not an image. */
  let logoError = $state<string | undefined>();

  $effect(() => {
    void window.skaro.invoke('project.settings', p.project.id).then((s) => (settings = s));
  });

  function change(patch: Partial<ProjectSettings>): void {
    if (!settings) return;
    const next = { ...settings, ...patch };
    settings = next;
    void window.skaro.invoke('project.saveSettings', p.project.id, $state.snapshot(next));
  }

  async function rename(input: HTMLInputElement): Promise<void> {
    const name = input.value.trim();
    if (!name || name === p.project.name) {
      input.value = p.project.name;
      return;
    }
    await window.skaro.invoke('project.rename', p.project.id, name);
    p.onchanged();
  }

  async function pickLogo(): Promise<void> {
    logoError = undefined;
    try {
      const picked = await window.skaro.invoke('project.pickLogo', p.project.id);
      if (picked) p.onchanged();
    } catch (error) {
      const text = String(error);
      logoError = text.includes('too large')
        ? t('params.logo.tooLarge')
        : text.includes('unsupported')
          ? t('params.logo.unsupported')
          : t('params.logo.failed');
      console.error(error);
    }
  }

  async function removeLogo(): Promise<void> {
    logoError = undefined;
    await window.skaro.invoke('project.removeLogo', p.project.id);
    p.onchanged();
  }

  async function remove(): Promise<void> {
    await window.skaro.invoke('projects.remove', p.project.id);
    p.onremove();
  }

  return {
    p,
    get settings() {
      return settings;
    },
    get logoError() {
      return logoError;
    },
    change,
    rename,
    pickLogo,
    removeLogo,
    remove,
  };
}
export type ProjectParamsController = ReturnType<typeof createProjectParamsController>;
