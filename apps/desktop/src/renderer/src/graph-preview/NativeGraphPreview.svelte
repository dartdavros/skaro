<script lang="ts">
  import { onMount } from 'svelte';
  import { Banner, t } from '@skaro/ui';
  import { readC4Model, validateC4Model, type C4Model } from '@skaro/core/c4-view';
  import C4Viewer from '../c4/C4Viewer.svelte';
  import GraphPreview from './GraphPreview.svelte';
  import '../c4/i18n';
  let {
    projectId,
    destination,
    onclose,
  }: { projectId: string; destination: string; onclose: () => void } = $props();
  let model = $state.raw<C4Model>();
  let error = $state('');
  onMount(() => {
    void window.skaro
      .invoke('graph.model', projectId)
      .then((source) => {
        if (!source) throw new Error('The project has no accepted C4 model.');
        const parsed = readC4Model(source);
        const errors = validateC4Model(parsed);
        if (errors.length) throw new Error(errors.join('; '));
        model = parsed;
      })
      .catch((reason) => (error = String(reason)));
  });
</script>

{#if error}<Banner kind="error" text={t('graph.error', { error })} />
{:else if model}
  <GraphPreview {model} />
  {#if destination === 'c4'}
    <C4Viewer
      {model}
      initialView={model.views.find((v) => v.kind === 'container' && v.state === 'current')!.id}
      {onclose}
    />
  {/if}
{/if}
