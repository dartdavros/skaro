<script lang="ts">
  import { untrack } from 'svelte';
  import { Button, Modal, Select, TextField, t } from '@skaro/ui';
  import { DEFAULT_UPSTREAM_POLICY, type Route } from '@skaro/timeline';
  import type { ModelSettingsController } from './controller.svelte';
  import { connectionName } from './profiles';
  let { controller, current }: { controller: ModelSettingsController; current: Route | 'new' } =
    $props();
  const original = untrack(() => (current === 'new' ? undefined : current));
  const connections = untrack(() => controller.snapshot!.configuration.connections);
  let open = $state(true);
  const initialConnection = original?.connectionId ?? connections[0]?.id ?? '';
  let connection = $state(initialConnection);
  let modelId = $state(original?.modelId ?? '');
  let parameters = $state(
    JSON.stringify(
      original?.parameters ??
        (connections.find((entry) => entry.id === initialConnection)?.connector === 'openai'
          ? { max_output_tokens: 1024 }
          : { max_tokens: 1024 }),
    ),
  );
  let error = $state('');
  const id = crypto.randomUUID();
  $effect(() => {
    if (!open) controller.route = undefined;
  });
  async function save() {
    error = '';
    let value: unknown;
    try {
      value = JSON.parse(parameters);
    } catch {
      error = t('models.parametersError');
      return;
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      error = t('models.parametersError');
      return;
    }
    const parent = connections.find((entry) => entry.id === connection);
    if (!parent) return;
    await controller.saveRoute({
      id: original?.id ?? id,
      revision: (original?.revision ?? 0) + 1,
      connectionId: connection,
      modelId: modelId.trim(),
      parameters: value as Route['parameters'],
      upstream: original?.upstream ?? parent.routing ?? DEFAULT_UPSTREAM_POLICY,
    });
  }
</script>

<Modal
  bind:open
  width={480}
  closable={!controller.busy}
  title={t(original ? 'models.editRoute' : 'models.addRoute')}
>
  <div class="model-fields" aria-busy={controller.busy}>
    <div class="model-field">
      <span class="sk-label">{t('models.connection')}</span>
      <Select
        label={t('models.connection')}
        width="100%"
        menuWidth="100%"
        disabled={controller.busy}
        options={connections.map((entry) => ({
          value: entry.id,
          label: `${connectionName(entry.connector)} · ${entry.id}`,
          description: entry.endpoint,
        }))}
        bind:value={connection}
      />
    </div>
    <TextField
      label={t('models.modelId')}
      bind:value={modelId}
      disabled={controller.busy}
      spellcheck={false}
    />
    <TextField
      label={t('models.parameters')}
      bind:value={parameters}
      disabled={controller.busy}
      spellcheck={false}
    />
    <span class="model-note">{t('models.routesNote')}</span>
    <span class="model-error" role={error || controller.error ? 'alert' : undefined}
      >{error || controller.error}</span
    >
  </div>
  {#snippet footer()}
    <Button
      disabled={controller.busy}
      onclick={() => {
        open = false;
      }}>{t('ui.cancel')}</Button
    >
    <Button
      variant="primary"
      disabled={controller.busy || !connection || !modelId.trim()}
      onclick={() => void save()}>{t('models.save')}</Button
    >
  {/snippet}
</Modal>
