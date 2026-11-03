<script lang="ts">
  import { Select, t } from '@skaro/ui';
  import type { ModelCatalogEntry } from '@skaro/agent-runtime';
  import { catalogEfforts, effortParameter } from '@skaro/agent-runtime/catalog-effort';
  import { effortLabel } from '../../screens/agent-settings-presentation';
  import { effortParameters, withEffort } from './route-parameters';
  let {
    metadata,
    connector,
    parameters = $bindable(''),
    disabled = false,
  }: {
    metadata: ModelCatalogEntry | undefined;
    connector: string;
    parameters: string;
    disabled?: boolean;
  } = $props();
  const parsed = $derived(effortParameters(parameters));
  const levels = $derived(catalogEfforts(connector, metadata));
  const effort = $derived(parsed?.[effortParameter(connector)]);
  const selected = $derived(typeof effort === 'string' ? effort : '');
  const options = $derived([
    { value: '', label: t(levels.length ? 'models.serviceDefault' : 'models.effortUnknown') },
    ...(selected && !levels.includes(selected)
      ? [{ value: selected, label: effortLabel(selected), description: t('models.effortMissing') }]
      : []),
    ...levels.map((value) => ({ value, label: effortLabel(value) })),
  ]);
</script>

<div class="model-field">
  <span class="sk-label">{t('settings.agent.effort')}</span>
  <Select
    label={t('settings.agent.effort')}
    width="100%"
    menuWidth="100%"
    {options}
    disabled={disabled || !parsed || !levels.length}
    bind:value={
      () => selected,
      (value) => {
        parameters = withEffort(parameters, value, connector);
      }
    }
  />
</div>
