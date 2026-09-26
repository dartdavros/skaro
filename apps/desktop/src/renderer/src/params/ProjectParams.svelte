<script lang="ts">
  import { t } from '@skaro/ui';
  import type { ProjectInfo, ProjectSettings } from '../../../shared/ipc';
  import AgentDefaults from './AgentDefaults.svelte';
  import './i18n';
  import ProjectRules from './ProjectRules.svelte';

  /** "Параметры проекта" (ProjectSettings mockup): saved on every change. */
  let { project, onremove }: { project: ProjectInfo; onremove: () => void } = $props();

  let settings = $state<ProjectSettings | undefined>();

  $effect(() => {
    void window.skaro.invoke('project.settings', project.id).then((s) => (settings = s));
  });

  function change(patch: Partial<ProjectSettings>): void {
    if (!settings) return;
    const next = { ...settings, ...patch };
    settings = next;
    void window.skaro.invoke('project.saveSettings', project.id, $state.snapshot(next));
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
