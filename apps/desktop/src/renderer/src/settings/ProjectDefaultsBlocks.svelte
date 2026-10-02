<script lang="ts">
  import { t } from '@skaro/ui';
  import type { ProjectDefaults } from '../../../shared/ipc';
  import '../params/i18n';
  import RulesBranches from '../params/RulesBranches.svelte';
  import RulesFiles from '../params/RulesFiles.svelte';
  import RulesInstructions from '../params/RulesInstructions.svelte';

  /**
   * Project settings for all projects (a project uses them until it sets its own): "Ветки и
   * слияние" in "Задачи и ветки", the agent files and instructions in "Проекты".
   */
  let { part }: { part: 'work' | 'projects' } = $props();

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
  {#if part === 'work'}
    <RulesBranches {value} note={t('settings.branches.note')} onchange={change} />
  {:else}
    <RulesFiles {value} onchange={change} />
    <RulesInstructions {value} note={t('settings.instructions.note')} onchange={change} />
  {/if}
{/if}
