<script lang="ts">
  import { ActionMenu, IconButton, t } from '@skaro/ui';
  import { Download } from '@lucide/svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import type { GraphExportSource } from './export-graph';
  import type { ProjectGraph } from './data.svelte';
  import { exportGraph } from './export-graph';
  import { exportError } from '../diagram-export/i18n';
  let {
    model,
    live,
    surface,
  }: {
    model: ProjectGraph;
    live?: GraphExportSource | undefined;
    surface?: HTMLElement | undefined;
  } = $props();
  let busy = $state(false);
  const disabled = $derived(!surface || !model.snapshot?.nodes || !model.page || model.loading);
  async function run(format: 'png' | 'gexf', all: boolean): Promise<void> {
    if (!surface || busy || disabled || (!all && !live)) return;
    busy = true;
    model.error = '';
    try {
      await exportGraph(model, live, format, all, surface);
    } catch (error) {
      model.error = exportError(error);
    } finally {
      busy = false;
    }
  }
  const items = $derived(
    (['png', 'gexf'] as const).flatMap((format) =>
      [false, true].map((all) => ({
        label: t(`export.${all ? 'all' : 'current'}.${format}`),
        disabled: disabled || (!all && !live),
        onselect: () => void run(format, all),
      })),
    ),
  );
</script>

{#if busy}
  <IconButton size={30} tip={t('export.busy')} disabled aria-busy="true"
    ><LoadingIndicator size={16} /></IconButton
  >
{:else}
  <ActionMenu tip={t('export.menu')} align="right" width={280} {items}>
    {#snippet button({ toggle, open })}
      <IconButton
        size={30}
        tip={t('export.menu')}
        active={open}
        onclick={toggle}
        {disabled}
        aria-expanded={open}
        aria-haspopup="menu"><Download size={16} /></IconButton
      >
    {/snippet}
  </ActionMenu>
{/if}
