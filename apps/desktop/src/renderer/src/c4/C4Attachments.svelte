<script lang="ts">
  import { Banner } from '@skaro/ui';
  import { readC4Model, validateC4Model, type C4Model } from '@skaro/core/c4-view';
  import C4Preview from './C4Preview.svelte';
  import C4Viewer from './C4Viewer.svelte';
  let {
    source,
    attachment,
  }: { source?: string; attachment?: { model: C4Model; views: string[] } } = $props();
  let opened = $state<string>();
  const parsed = $derived.by((): { model?: C4Model; views: string[]; error?: string } => {
    try {
      const payload =
        attachment ?? (JSON.parse(source ?? '') as { model: unknown; views: unknown });
      const model = readC4Model(payload.model);
      const errors = validateC4Model(model);
      if (errors.length) throw new Error(errors.join('\n'));
      if (
        !Array.isArray(payload.views) ||
        payload.views.some((id) => typeof id !== 'string' || !model.views.some((v) => v.id === id))
      )
        throw new Error('C4: unknown document view');
      return { model, views: payload.views as string[] };
    } catch (error) {
      return { views: [], error: String(error) };
    }
  });
</script>

<div class="c4-attachments">
  {#if parsed.error}<Banner kind="error" text={parsed.error} />{/if}
  {#if parsed.model}
    {#each parsed.views as id (id)}<C4Preview
        model={parsed.model}
        view={parsed.model.views.find((v) => v.id === id)!}
        onopen={() => (opened = id)}
      />{/each}
    {#if opened && parsed.views.includes(opened)}<C4Viewer
        model={parsed.model}
        initialView={opened}
        onclose={() => (opened = undefined)}
      />{/if}
  {/if}
</div>

<style>
  .c4-attachments {
    display: flex;
    flex-direction: column;
    gap: 18px;
    width: 100%;
    min-width: 0;
  }
</style>
