<script lang="ts">
  import { Segmented, t } from '@skaro/ui';
  import type { ProjectDefaults } from '../../../shared/ipc';
  import SwitchRow from './SwitchRow.svelte';

  /**
   * "Ветки и слияние", "Чат и файлы агентов", "Инструкции агенту" (ProjectSettings mockup): the
   * same blocks in a project's parameters and, as defaults for every project, in "Настройки".
   */
  let {
    value,
    instructionsNote,
    onchange,
  }: {
    value: ProjectDefaults;
    instructionsNote: string;
    onchange: (patch: Partial<ProjectDefaults>) => void;
  } = $props();

  const change = (patch: Partial<ProjectDefaults>): void => onchange(patch);
</script>

<section class="card">
  <span class="label">{t('params.branches')}</span>
  <div class="fields">
    <label class="field">
      <span class="key">{t('params.base')}</span>
      <input
        class="mono"
        data-tip={t('params.base.tip')}
        value={value.baseBranch}
        onchange={(e) => change({ baseBranch: e.currentTarget.value })}
      />
    </label>
    <label class="field">
      <span class="key">{t('params.template')}</span>
      <input
        class="mono"
        data-tip={t('params.template.tip')}
        value={value.branchTemplate}
        onchange={(e) => change({ branchTemplate: e.currentTarget.value })}
      />
    </label>
  </div>
  <div class="choices">
    <div class="choice">
      <span class="key">{t('params.iso')}</span>
      <Segmented
        label={t('params.iso')}
        bind:value={() => value.isolation, (v) => change({ isolation: v })}
        options={[
          {
            value: 'worktree',
            label: t('params.iso.worktree'),
            tip: t('params.iso.worktree.tip'),
          },
          {
            value: 'in-place',
            label: t('params.iso.inPlace'),
            tip: t('params.iso.inPlace.tip'),
          },
        ]}
      />
    </div>
    <div class="choice">
      <span class="key">{t('params.merge')}</span>
      <Segmented
        label={t('params.merge')}
        bind:value={() => value.mergeStrategy, (v) => change({ mergeStrategy: v })}
        options={[
          { value: 'squash', label: 'Squash', tip: t('params.merge.squash.tip') },
          { value: 'merge', label: 'Merge', tip: t('params.merge.merge.tip') },
          { value: 'rebase', label: 'Rebase', tip: t('params.merge.rebase.tip') },
        ]}
      />
    </div>
  </div>
  <SwitchRow
    checked={value.deleteBranch}
    label={t('params.deleteBranch')}
    note={t('params.deleteBranch.note')}
    onchange={(on) => change({ deleteBranch: on })}
  />
</section>

<section class="card tight">
  <span class="label pad">{t('params.files')}</span>
  <SwitchRow
    checked={value.autoAcceptDocs}
    label={t('params.autoDocs')}
    note={t('params.autoDocs.note')}
    onchange={(on) => change({ autoAcceptDocs: on })}
  />
  <SwitchRow
    checked={value.agentFiles}
    label={t('params.agentFiles')}
    note={t('params.agentFiles.note')}
    onchange={(on) => change({ agentFiles: on })}
  />
</section>

<section class="card mid">
  <span class="label">{t('params.instructions')}</span>
  <span class="note">{instructionsNote}</span>
  <textarea
    placeholder={t('params.instructions.ph')}
    value={value.agentInstructions}
    onchange={(e) => change({ agentInstructions: e.currentTarget.value })}></textarea>
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 14px 15px;
    border-radius: 10px;
    background: var(--sk-fill-16);
  }

  .card.tight {
    gap: 4px;
  }

  .card.mid {
    gap: 9px;
  }

  .label {
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--sk-text-23);
  }

  .label.pad {
    padding-bottom: 6px;
  }

  .fields {
    display: flex;
    gap: 14px;
    flex-wrap: wrap;
  }

  .field {
    flex: 1;
    min-width: 200px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }

  .choices {
    display: flex;
    gap: 20px;
    flex-wrap: wrap;
  }

  .choice {
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

  .mono {
    font-family: var(--sk-mono);
  }

  input:hover {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-fill-31);
  }

  input:focus {
    background: var(--sk-field-hover);
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }

  .note {
    font-size: var(--sk-fs-3);
    line-height: 1.45;
    color: var(--sk-text-21);
    text-wrap: pretty;
  }

  textarea {
    min-height: 84px;
    padding: 10px 12px;
    border: none;
    border-radius: 9px;
    background: var(--sk-fill-20);
    color: var(--sk-text-6);
    font-size: var(--sk-fs-5);
    line-height: 1.55;
    resize: vertical;
    outline: none;
  }

  textarea:focus {
    box-shadow: inset 0 0 0 1px var(--sk-accent);
  }
</style>
