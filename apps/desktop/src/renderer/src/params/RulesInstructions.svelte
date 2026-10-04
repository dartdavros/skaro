<script lang="ts">
  import { t } from '@skaro/ui';
  import type { ProjectDefaults } from '../../../shared/ipc';
  import Section from '../settings/Section.svelte';
  import './project-rules.css';

  /** "Инструкции агенту": free text added to every run and chat message. */
  let {
    value,
    note,
    onchange,
  }: {
    value: ProjectDefaults;
    note: string;
    onchange: (patch: Partial<ProjectDefaults>) => void;
  } = $props();
</script>

<Section title={t('params.instructions')} {note} bare>
  <textarea
    data-project-rules
    aria-label={t('params.instructions')}
    placeholder={t('params.instructions.ph')}
    value={value.agentInstructions}
    onchange={(e) => onchange({ agentInstructions: e.currentTarget.value })}></textarea>
</Section>
