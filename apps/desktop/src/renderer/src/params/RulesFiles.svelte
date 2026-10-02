<script lang="ts">
  import { t, Toggle } from '@skaro/ui';
  import type { ProjectDefaults } from '../../../shared/ipc';
  import Row from '../settings/Row.svelte';
  import Section from '../settings/Section.svelte';

  /** "Чат и файлы агентов": documents applied at once, the Skaro block in the agent files. */
  let {
    value,
    onchange,
  }: { value: ProjectDefaults; onchange: (patch: Partial<ProjectDefaults>) => void } = $props();
</script>

<Section title={t('params.files')}>
  <Row tall title={t('params.autoDocs')} note={t('params.autoDocs.note')}>
    <Toggle
      ariaLabel={t('params.autoDocs')}
      bind:checked={() => value.autoAcceptDocs, (on) => onchange({ autoAcceptDocs: on })}
    />
  </Row>
  <Row tall title={t('params.agentFiles')} note={t('params.agentFiles.note')}>
    <Toggle
      ariaLabel={t('params.agentFiles')}
      bind:checked={() => value.agentFiles, (on) => onchange({ agentFiles: on })}
    />
  </Row>
</Section>
