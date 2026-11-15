<script lang="ts">
  import { tn, t } from '@skaro/ui';
  import { agents } from '../agents.svelte';
  import AgentModal from '../task/AgentModal.svelte';
  import type { RunProps } from './run-props';
  import { createRunController } from './run-controller.svelte';

  let { projectId, tasks, onconfirm, onclose }: RunProps = $props();
  let open = $state(true);
  const controller = createRunController({
    get projectId() {
      return projectId;
    },
    get tasks() {
      return tasks;
    },
    get onconfirm() {
      return onconfirm;
    },
    get onclose() {
      return onclose;
    },
  });

  $effect(() => {
    if (!open) onclose();
  });
</script>

{#if controller.settings}
  <AgentModal
    bind:open
    kind="launch"
    {projectId}
    settings={controller.settings}
    agents={agents.list}
    locked={false}
    sandboxHolds={controller.sandboxHolds}
    title={t('board.rd.title')}
    subtitle={tn('board.rd.selected', tasks.length)}
    actionLabel={t('board.rd.action', { n: tasks.length })}
    onsave={controller.confirm}
  />
{/if}
