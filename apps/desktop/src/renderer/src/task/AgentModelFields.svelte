<script lang="ts">
  import { EffortSlider, Icon, Select, t } from '@skaro/ui';
  import type { AgentModalController } from './agent-modal-controller.svelte';
  let { controller }: { controller: AgentModalController } = $props();
</script>

<div class="section">
  <span class="sk-label">{t('agent.model')}</span>
  {#if controller.models && controller.models.length}
    <div data-tip={t('agent.model.tip')}>
      <Select
        variant="model"
        width="100%"
        menuWidth="100%"
        label={t('agent.model')}
        bind:value={() => controller.model?.id ?? '', (v) => (controller.draft.model = v)}
        options={controller.models.map((m) => ({
          value: m.id,
          label: m.name,
          description: m.description,
          ...(m.isDefault ? { tag: t('agent.model.default') } : {}),
        }))}
      />
    </div>
  {:else if controller.modelsError || (controller.info && !controller.info.installed && !controller.info.download && controller.info.error)}
    <div class="models-error">
      <Icon name="error" size={14} stroke={2} color="var(--sk-error)" />
      <span class="models-error-text">{t('agent.model.error')}</span>
      <button
        type="button"
        class="models-retry"
        onclick={() => {
          if (controller.info?.installed) void controller.loadModels(controller.draft.agent, true);
          else if (controller.info)
            void window.skaro.invoke('agents.install', controller.info.id).catch(() => undefined);
        }}>{t('agent.model.retry')}</button
      >
    </div>
  {:else}
    <div class="models-loading" aria-label={t('agent.model.loading')}>
      {#each [42, 55, 36] as width (width)}
        <div class="skeleton">
          <span class="bar" style="width: {width}%"></span>
          <span class="bar thin"></span>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if controller.efforts.length > 1}
  <div class="section">
    <span class="sk-label">{t('agent.effort')}</span>
    <EffortSlider
      levels={controller.efforts}
      bind:value={
        () => controller.draft.effort ?? controller.effortDefault ?? controller.efforts[0]!.id,
        (v) => (controller.draft.effort = v)
      }
      {...controller.effortDefault ? { defaultValue: controller.effortDefault } : {}}
    />
  </div>
{/if}
