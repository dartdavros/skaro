<script lang="ts">
  import { t } from '@skaro/ui';
  import type { ProjectDefaults } from '../../../shared/ipc';
  import '../params/i18n';
  import ProjectRules from '../params/ProjectRules.svelte';

  /** Project settings for all projects: a project uses them until it sets its own. */
  let value = $state<ProjectDefaults | undefined>();

  $effect(() => {
    void window.skaro.invoke('app.projectDefaults').then((v) => (value = v));
  });

  function change(patch: Partial<ProjectDefaults>): void {
    if (!value) return;
    const next = { ...value, ...patch };
    value = next;
    void window.skaro.invoke('app.setProjectDefaults', $state.snapshot(next));
  }
</script>

{#if value}
  <ProjectRules {value} instructionsNote={t('settings.instructions.note')} onchange={change} />
{/if}
