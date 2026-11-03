<script lang="ts">
  import { Button, ConfirmDialog, t } from '@skaro/ui';
  import Row from '../Row.svelte';
  import Section from '../Section.svelte';
  import LoadingIndicator from '../../LoadingIndicator.svelte';
  import ConnectionForm from './ConnectionForm.svelte';
  import RouteForm from './RouteForm.svelte';
  import { createModelSettingsController } from './controller.svelte';
  import { connectionName } from './profiles';
  import './i18n';
  import './models.css';
  let { disabled = false }: { disabled?: boolean } = $props();
  const state = createModelSettingsController();
  const connections = $derived(state.snapshot?.configuration.connections ?? []);
  const routes = $derived(state.snapshot?.configuration.routes ?? []);
  const protectedStorage = $derived(state.snapshot?.protection.state === 'available');
  function keySaved(id: string) {
    const entry = connections.find((connection) => connection.id === id);
    return (
      !!entry &&
      state.snapshot?.credentials.some(
        (key) =>
          key.binding.connectionId === id &&
          key.binding.connectionRevision === entry.revision &&
          key.binding.endpoint === entry.endpoint &&
          key.reference.id === entry.credential.id &&
          key.reference.revision === entry.credential.revision,
      )
    );
  }
</script>

<Section title={t('models.connections')} note={t('models.note')}>
  <Row
    title={!state.snapshot
      ? t('models.connections')
      : connections.length
        ? t('models.saved')
        : t('models.emptyConnections')}
  >
    <div class="model-actions">
      <span class="model-progress"
        >{#if state.loading || state.busy}<LoadingIndicator size={16} />{/if}</span
      >
      <Button
        size="sm"
        disabled={disabled || state.busy || state.loading || !protectedStorage}
        onclick={() => {
          state.connection = 'new';
        }}>{t('models.addConnection')}</Button
      >
    </div>
  </Row>
  {#if state.error || (state.snapshot && !protectedStorage)}
    <Row title={state.error || t('models.protectionUnavailable')}>
      <Button
        size="sm"
        disabled={disabled || state.loading || state.busy}
        onclick={() => void state.load()}>{t('models.refresh')}</Button
      >
    </Row>
  {/if}
  {#each connections as connection (connection.id)}
    <Row
      title={connectionName(connection.connector)}
      note={`${connection.id} · ${connection.endpoint} · ${t(keySaved(connection.id) ? 'models.keySaved' : 'models.keyMissing')}`}
    >
      <div class="model-actions">
        <Button
          size="sm"
          disabled={disabled || state.busy || state.loading || !protectedStorage}
          onclick={() => {
            state.connection = connection;
          }}>{t('models.edit')}</Button
        >
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || state.busy || state.loading || !protectedStorage}
          onclick={() => {
            state.removal = { kind: 'connection', id: connection.id };
          }}>{t('models.remove')}</Button
        >
      </div>
    </Row>
  {/each}
</Section>
<Section title={t('models.routes')} note={t('models.routesNote')}>
  <Row title={!state.snapshot || routes.length ? t('models.routes') : t('models.emptyRoutes')}>
    <Button
      size="sm"
      disabled={disabled || state.busy || state.loading || !connections.length}
      onclick={() => {
        state.route = 'new';
      }}>{t('models.addRoute')}</Button
    >
  </Row>
  {#each routes as route (route.id)}
    <Row
      title={route.modelId}
      note={`${connectionName(connections.find((connection) => connection.id === route.connectionId)?.connector ?? '')} · ${route.connectionId}`}
    >
      <div class="model-actions">
        <Button
          size="sm"
          disabled={disabled || state.busy || state.loading}
          onclick={() => {
            state.route = route;
          }}>{t('models.edit')}</Button
        >
        <Button
          size="sm"
          variant="ghost"
          disabled={disabled || state.busy || state.loading}
          onclick={() => {
            state.removal = { kind: 'route', id: route.id };
          }}>{t('models.remove')}</Button
        >
      </div>
    </Row>
  {/each}
</Section>
{#if state.connection}<ConnectionForm controller={state} current={state.connection} />{/if}
{#if state.route}<RouteForm controller={state} current={state.route} />{/if}
{#if state.removal}
  {@const removal = state.removal}
  <ConfirmDialog
    title={t(
      state.removal.kind === 'connection' ? 'models.removeConnection' : 'models.removeRoute',
    )}
    text={t(
      state.removal.kind === 'connection'
        ? 'models.removeConnectionText'
        : 'models.removeRouteText',
    )}
    action={t('models.remove')}
    onconfirm={() => void state.remove(removal)}
    bind:open={
      () => !!state.removal,
      (open) => {
        if (!open) state.removal = undefined;
      }
    }
  />
{/if}
