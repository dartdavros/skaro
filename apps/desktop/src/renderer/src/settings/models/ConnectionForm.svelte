<script lang="ts">
  import { untrack } from 'svelte';
  import { Button, Modal, Select, TextField, t } from '@skaro/ui';
  import { DEFAULT_UPSTREAM_POLICY, type Connection } from '@skaro/timeline';
  import type { ModelSettingsController } from './controller.svelte';
  import { CONNECTION_PROFILES } from './profiles';
  let {
    controller,
    current,
  }: { controller: ModelSettingsController; current: Connection | 'new' } = $props();
  const original = untrack(() => (current === 'new' ? undefined : current));
  let open = $state(true),
    secret = $state('');
  let provider = $state(original?.connector ?? 'openrouter');
  let endpoint = $state(original?.endpoint ?? CONNECTION_PROFILES[0].endpoint);
  let selected = $state('new');
  const id = crypto.randomUUID();
  const available = $derived(
    controller.snapshot?.credentials.filter(
      (entry) =>
        !controller.snapshot?.configuration.connections.some(
          (item) => item.id === entry.binding.connectionId,
        ),
    ) ?? [],
  );
  const selectedKey = $derived(available.find((entry) => entry.binding.connectionId === selected));
  const canSave = $derived(
    !!endpoint.trim() && (!!original || !!selectedKey || !!secret) && !controller.busy,
  );
  $effect(() => {
    if (!open) {
      secret = '';
      controller.connection = undefined;
    }
  });
  function chooseProvider(value: string) {
    provider = value;
    endpoint = CONNECTION_PROFILES.find((item) => item.id === value)!.endpoint;
  }
  function chooseKey(value: string) {
    selected = value;
    secret = '';
    const entry = available.find((item) => item.binding.connectionId === value);
    if (entry) endpoint = entry.binding.endpoint;
  }
  async function save() {
    if (!canSave) return;
    const profile = CONNECTION_PROFILES.find((item) => item.id === provider)!;
    const token = secret || undefined;
    secret = '';
    const changed =
      !!token ||
      (original && (endpoint.trim() !== original.endpoint || provider !== original.connector));
    await controller.saveConnection(
      {
        id: original?.id ?? selectedKey?.binding.connectionId ?? id,
        revision: original
          ? original.revision + (changed ? 1 : 0)
          : (selectedKey?.binding.connectionRevision ?? 1),
        connector: provider,
        endpoint: endpoint.trim(),
        apiProfile: { id: profile.profile, revision: 1 },
        settings: original?.settings ?? {},
        routing: original?.routing ?? DEFAULT_UPSTREAM_POLICY,
      },
      token,
    );
  }
</script>

<Modal
  bind:open
  width={480}
  closable={!controller.busy}
  title={t(original ? 'models.editConnection' : 'models.addConnection')}
>
  <div class="model-fields" aria-busy={controller.busy}>
    <div class="model-field">
      <span class="sk-label">{t('models.provider')}</span>
      <Select
        label={t('models.provider')}
        width="100%"
        menuWidth="100%"
        disabled={controller.busy}
        options={CONNECTION_PROFILES.map((item) => ({ value: item.id, label: item.label }))}
        bind:value={() => provider, chooseProvider}
      />
    </div>
    {#if !original && available.length}
      <div class="model-field">
        <span class="sk-label">{t('models.savedKey')}</span>
        <Select
          label={t('models.savedKey')}
          width="100%"
          menuWidth="100%"
          disabled={controller.busy}
          options={[
            { value: 'new', label: t('models.newKey') },
            ...available.map((item) => ({
              value: item.binding.connectionId,
              label: item.binding.connectionId,
              description: item.binding.endpoint,
            })),
          ]}
          bind:value={() => selected, chooseKey}
        />
      </div>
    {/if}
    <TextField
      label={t('models.endpoint')}
      bind:value={endpoint}
      disabled={controller.busy}
      spellcheck={false}
    />
    <TextField
      type="password"
      label={t('models.key')}
      bind:value={secret}
      disabled={controller.busy || !!selectedKey}
      placeholder={original || selectedKey ? t('models.keepKey') : ''}
      autocomplete="off"
      spellcheck={false}
    />
    <span class="model-note">{t('models.keyNote')}</span>
    <span class="model-error" role={controller.error ? 'alert' : undefined}>{controller.error}</span
    >
  </div>
  {#snippet footer()}
    <Button
      disabled={controller.busy}
      onclick={() => {
        secret = '';
        open = false;
      }}>{t('ui.cancel')}</Button
    >
    <Button variant="primary" disabled={!canSave} onclick={() => void save()}
      >{t('models.save')}</Button
    >
  {/snippet}
</Modal>
