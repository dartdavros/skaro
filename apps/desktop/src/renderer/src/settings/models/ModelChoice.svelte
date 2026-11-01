<script lang="ts">
  import { Button, Select, TextField, t } from '@skaro/ui';
  import type { Connection } from '@skaro/timeline';
  import LoadingIndicator from '../../LoadingIndicator.svelte';
  import { createModelCatalogController } from './catalog-controller.svelte';
  let {
    connection,
    value = $bindable(''),
    disabled = false,
  }: {
    connection: Connection | undefined;
    value: string;
    disabled?: boolean;
  } = $props();
  const catalog = createModelCatalogController(() => connection);
  const models = $derived(catalog.snapshot?.models ?? []);
  const missing = $derived(
    !!value && !!catalog.snapshot && !models.some((entry) => entry.id === value),
  );
  const options = $derived([
    { value: '', label: t('models.chooseModel') },
    ...(missing ? [{ value, label: value, description: t('models.modelMissing') }] : []),
    ...models.map((entry) => ({ value: entry.id, label: entry.name, description: entry.id })),
  ]);
</script>

<div class="model-field">
  <span class="sk-label">{t('models.modelId')}</span>
  {#if catalog.snapshot}
    <Select
      label={t('models.modelId')}
      width="100%"
      menuWidth="100%"
      disabled={disabled || catalog.loading}
      {options}
      bind:value
    />
  {:else}
    <TextField aria-label={t('models.modelId')} bind:value {disabled} spellcheck={false} />
  {/if}
  <div class="model-catalog-status">
    <span class="model-progress"
      >{#if catalog.loading}<LoadingIndicator size={16} />{/if}</span
    >
    <span class="model-note"
      >{t(
        catalog.error
          ? 'models.catalogError'
          : missing
            ? 'models.modelMissing'
            : 'models.catalogNote',
      )}</span
    >
    <Button
      size="sm"
      disabled={disabled || catalog.loading || !connection}
      onclick={() => catalog.refresh()}>{t('models.refresh')}</Button
    >
  </div>
</div>
