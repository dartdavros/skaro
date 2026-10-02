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

  import './project-rules.css';
</script>

<section data-project-rules class="card">
  <span data-project-rules class="label">{t('params.branches')}</span>
  <div data-project-rules class="fields">
    <label data-project-rules class="field">
      <span data-project-rules class="key">{t('params.base')}</span>
      <input
        data-project-rules
        class="mono"
        data-tip={t('params.base.tip')}
        value={value.baseBranch}
        onchange={(e) => change({ baseBranch: e.currentTarget.value })}
      />
    </label>
    <label data-project-rules class="field">
      <span data-project-rules class="key">{t('params.template')}</span>
      <input
        data-project-rules
        class="mono"
        data-tip={t('params.template.tip')}
        value={value.branchTemplate}
        onchange={(e) => change({ branchTemplate: e.currentTarget.value })}
      />
    </label>
  </div>
  <div data-project-rules class="choices">
    <div data-project-rules class="choice">
      <span data-project-rules class="key">{t('params.iso')}</span>
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
    <div data-project-rules class="choice">
      <span data-project-rules class="key">{t('params.merge')}</span>
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

<section data-project-rules class="card tight">
  <span data-project-rules class="label pad">{t('params.files')}</span>
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

<section data-project-rules class="card mid">
  <span data-project-rules class="label">{t('params.instructions')}</span>
  <span data-project-rules class="note">{instructionsNote}</span>
  <textarea
    data-project-rules
    placeholder={t('params.instructions.ph')}
    value={value.agentInstructions}
    onchange={(e) => change({ agentInstructions: e.currentTarget.value })}></textarea>
</section>
