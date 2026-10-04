<script lang="ts">
  import { EffortSlider, Select, t } from '@skaro/ui';
  import Row from '../settings/Row.svelte';
  import { effortLabel } from './agent-settings-presentation';
  import type { AgentSettingsCardProps } from './agent-settings-card-props';
  let { a, state }: AgentSettingsCardProps = $props();
  const model = $derived(state.modelOf(a.id));
  const efforts = $derived(
    (model?.efforts ?? []).map((e) => ({ id: e.id, label: effortLabel(e.id) })),
  );
</script>

<Row title={t('settings.agent.account')}>
  <div data-agents-settings class="value">
    {#if a.installed && a.authenticated !== false}
      <span data-agents-settings class="account"
        >{#if a.account}{t('settings.agent.signedIn')}
          <span data-agents-settings class="mono">{a.account}</span>{:else}{t(
            'settings.agent.signedInNoAccount',
          )}{/if}</span
      >
    {:else}
      <span data-agents-settings class="need-login">{t('settings.agent.signedOut')}</span>
      <button
        data-agents-settings
        type="button"
        class="btn"
        disabled={!a.installed || state.busy[a.id]}
        data-tip={t('settings.agent.login.tip')}
        onclick={() => void state.run(a.id, () => window.skaro.invoke('agents.login', a.id))}
        >{t('agent.login')}</button
      >
    {/if}
  </div>
</Row>
<Row title={t('settings.agent.model')}>
  {#if state.models[a.id]?.length}
    <Select
      variant="model"
      width={280}
      menuWidth={280}
      label={t('settings.agent.model')}
      bind:value={() => model?.id ?? '', (v) => state.save(a.id, { model: v, effort: undefined })}
      options={(state.models[a.id] ?? []).map((m) => ({
        value: m.id,
        label: m.name,
        description: m.description,
        ...(m.isDefault ? { tag: t('agent.model.default') } : {}),
      }))}
    />
  {:else}
    <span data-agents-settings class="field-off">{t('settings.agent.model.off')}</span>
  {/if}
</Row>
<Row title={t('settings.agent.effort')}>
  {#if efforts.length > 1}
    {@const effortDefault = model?.defaultEffort ?? efforts[Math.floor(efforts.length / 2)]!.id}
    <div data-agents-settings class="field-width">
      <EffortSlider
        levels={efforts}
        bind:value={
          () =>
            efforts.some((e) => e.id === state.defaults[a.id]?.effort)
              ? state.defaults[a.id]!.effort!
              : effortDefault,
          (v) =>
            state.save(a.id, {
              ...(model ? { model: model.id } : {}),
              effort: v,
            })
        }
        defaultValue={effortDefault}
      />
    </div>
  {:else}
    <span data-agents-settings class="field-off">{t('settings.agent.model.off')}</span>
  {/if}
</Row>
