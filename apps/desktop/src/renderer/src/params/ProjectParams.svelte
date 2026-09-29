<script lang="ts">
  import { Button, Icon, t } from '@skaro/ui';
  import type { ProjectInfo, ProjectSettings } from '../../../shared/ipc';
  import ProjectAvatar from '../screens/ProjectAvatar.svelte';
  import AgentDefaults from './AgentDefaults.svelte';
  import './i18n';
  import ProjectRules from './ProjectRules.svelte';

  /** "Параметры проекта" (ProjectSettings mockup): saved on every change. */
  let {
    project,
    onremove,
    onchanged,
  }: { project: ProjectInfo; onremove: () => void; onchanged: () => void } = $props();

  let settings = $state<ProjectSettings | undefined>();
  /** The logo could not be taken: too large or not an image. */
  let logoError = $state<string | undefined>();

  $effect(() => {
    void window.skaro.invoke('project.settings', project.id).then((s) => (settings = s));
  });

  function change(patch: Partial<ProjectSettings>): void {
    if (!settings) return;
    const next = { ...settings, ...patch };
    settings = next;
    void window.skaro.invoke('project.saveSettings', project.id, $state.snapshot(next));
  }

  async function rename(input: HTMLInputElement): Promise<void> {
    const name = input.value.trim();
    if (!name || name === project.name) {
      input.value = project.name;
      return;
    }
    await window.skaro.invoke('project.rename', project.id, name);
    onchanged();
  }

  async function pickLogo(): Promise<void> {
    logoError = undefined;
    try {
      const picked = await window.skaro.invoke('project.pickLogo', project.id);
      if (picked) onchanged();
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
    await window.skaro.invoke('project.removeLogo', project.id);
    onchanged();
  }

  async function remove(): Promise<void> {
    await window.skaro.invoke('projects.remove', project.id);
    onremove();
  }
</script>

<div class="screen">
  <div class="head">
    <div class="inner">
      <div class="titles">
        <span class="title">{t('params.title')}</span>
        <span class="subtitle">{t('params.subtitle', { name: project.name })}</span>
      </div>
      <span class="spacer"></span>
      <span class="saved" data-tip={t('params.saved.tip')}>{t('params.saved')}</span>
    </div>
  </div>
  {#if settings}
    <div class="scroll">
      <div class="inner cards">
        <section class="card">
          <span class="label">{t('params.project')}</span>
          <div class="logo-row">
            <ProjectAvatar name={project.name} logo={project.logo} />
            <div class="logo-texts">
              <div class="logo-actions">
                <Button size="sm" onclick={() => void pickLogo()}
                  ><Icon name="image" size={14} />{t('params.logo.pick')}</Button
                >
                {#if project.logo}
                  <Button size="sm" onclick={() => void removeLogo()}
                    ><Icon name="close" size={13} stroke={2.2} />{t('params.logo.remove')}</Button
                  >
                {/if}
              </div>
              <span class="note" class:error={logoError !== undefined}
                >{logoError ?? t('params.logo.note')}</span
              >
            </div>
          </div>
          <label class="field">
            <span class="key">{t('params.name')}</span>
            <input
              value={project.name}
              data-tip={t('params.name.tip')}
              onchange={(e) => void rename(e.currentTarget)}
              onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
            />
          </label>
        </section>

        <section class="card">
          <span class="label">{t('params.agent')}</span>
          <AgentDefaults projectId={project.id} {settings} onchange={change} />
        </section>

        <ProjectRules
          value={settings}
          instructionsNote={t('params.instructions.note')}
          onchange={change}
        />

        <section class="card remove">
          <div class="remove-texts">
            <span class="remove-title">{t('params.remove')}</span>
            <span class="note">{t('params.remove.note')}</span>
          </div>
          <button
            type="button"
            class="remove-btn"
            data-tip={t('params.remove.tip')}
            onclick={remove}>{t('params.remove.action')}</button
          >
        </section>
      </div>
    </div>
  {/if}
</div>

<style>
  .screen {
    flex: 1;
    min-width: 0;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--sk-fill-5);
  }

  .head {
    flex: none;
    padding: 14px 18px 10px;
    display: flex;
    justify-content: center;
  }

  .inner {
    width: 100%;
    max-width: 760px;
  }

  .head .inner {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .title {
    font-size: var(--sk-fs-13);
    font-weight: 700;
    color: var(--sk-text-5);
  }

  .subtitle {
    font-size: var(--sk-fs-4);
    color: var(--sk-text-21);
  }

  .spacer {
    flex: 1;
  }

  .saved {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-23);
  }

  .scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 0 18px 18px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }

  .cards {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 15px;
    border-radius: 10px;
    background: var(--sk-fill-16);
  }

  .label {
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--sk-text-23);
  }

  .note {
    font-size: var(--sk-fs-3);
    line-height: 1.45;
    color: var(--sk-text-21);
    text-wrap: pretty;
  }

  .logo-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .logo-texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .logo-actions {
    display: flex;
    gap: 8px;
  }

  .note.error {
    color: var(--sk-error);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .key {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-19);
  }

  input {
    height: 32px;
    padding: 0 11px;
    border: none;
    border-radius: 8px;
    background: var(--sk-fill-3);
    color: var(--sk-text-6);
    font-size: var(--sk-fs-5);
    outline: none;
    box-shadow: inset 0 0 0 1px var(--sk-fill-25);
  }

  input:hover {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-fill-31);
  }

  input:focus {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }

  .card.remove {
    flex-direction: row;
    align-items: center;
    padding: 13px 15px;
  }

  .remove-texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .remove-title {
    font-size: var(--sk-fs-5);
    font-weight: 600;
    color: var(--sk-text-7);
  }

  .remove-btn {
    flex: none;
    height: 31px;
    padding: 0 13px;
    border: none;
    border-radius: 8px;
    background: var(--sk-red-9);
    color: var(--sk-error);
    font-size: var(--sk-fs-5);
    font-weight: 600;
    cursor: pointer;
  }

  .remove-btn:hover {
    background: var(--sk-error-a18);
  }
</style>
