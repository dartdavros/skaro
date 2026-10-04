<script lang="ts">
  import { Segmented, t, Toggle } from '@skaro/ui';
  import type { ProjectDefaults } from '../../../shared/ipc';
  import Row from '../settings/Row.svelte';
  import Section from '../settings/Section.svelte';
  import './project-rules.css';

  /** "Ветки и слияние": base branch, branch name template, isolation, merge method, cleanup. */
  let {
    value,
    note,
    onchange,
  }: {
    value: ProjectDefaults;
    note?: string;
    onchange: (patch: Partial<ProjectDefaults>) => void;
  } = $props();

  const isoNote = $derived(
    value.isolation === 'in-place' ? t('params.iso.inPlace.tip') : t('params.iso.worktree.tip'),
  );
  const mergeNote = $derived(t(`params.merge.${value.mergeStrategy}.tip`));
</script>

<Section title={t('params.branches')} {...note ? { note } : {}}>
  <Row title={t('params.base')} note={t('params.base.tip')}>
    <input
      data-project-rules
      class="mono"
      aria-label={t('params.base')}
      value={value.baseBranch}
      onchange={(e) => onchange({ baseBranch: e.currentTarget.value })}
    />
  </Row>
  <Row title={t('params.template')} note={t('params.template.tip')}>
    <input
      data-project-rules
      class="mono"
      aria-label={t('params.template')}
      value={value.branchTemplate}
      onchange={(e) => onchange({ branchTemplate: e.currentTarget.value })}
    />
  </Row>
  <Row title={t('params.iso')} note={isoNote}>
    <Segmented
      label={t('params.iso')}
      bind:value={() => value.isolation, (v) => onchange({ isolation: v })}
      options={[
        { value: 'worktree', label: t('params.iso.worktree') },
        { value: 'in-place', label: t('params.iso.inPlace') },
      ]}
    />
  </Row>
  <Row title={t('params.merge')} note={mergeNote}>
    <Segmented
      label={t('params.merge')}
      bind:value={() => value.mergeStrategy, (v) => onchange({ mergeStrategy: v })}
      options={[
        { value: 'squash', label: 'Squash' },
        { value: 'merge', label: 'Merge' },
        { value: 'rebase', label: 'Rebase' },
      ]}
    />
  </Row>
  <Row tall title={t('params.deleteBranch')} note={t('params.deleteBranch.note')}>
    <Toggle
      ariaLabel={t('params.deleteBranch')}
      bind:checked={() => value.deleteBranch, (on) => onchange({ deleteBranch: on })}
    />
  </Row>
</Section>
