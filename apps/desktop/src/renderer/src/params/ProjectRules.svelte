<script lang="ts">
  import type { ProjectDefaults } from '../../../shared/ipc';
  import RulesBranches from './RulesBranches.svelte';
  import RulesFiles from './RulesFiles.svelte';
  import RulesInstructions from './RulesInstructions.svelte';

  /**
   * "Ветки и слияние", "Чат и файлы агентов", "Инструкции агенту" of a project's parameters; the
   * same sections, as defaults for every project, are spread over the categories of "Настройки".
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
</script>

<RulesBranches {value} {onchange} />
<RulesFiles {value} {onchange} />
<RulesInstructions {value} note={instructionsNote} {onchange} />
