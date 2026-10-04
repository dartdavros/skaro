<script lang="ts">
  import { Button, Icon, t } from '@skaro/ui';
  import ProjectAvatar from '../screens/ProjectAvatar.svelte';
  import type { ProjectParamsController } from './project-params-controller.svelte';
  let { state }: { state: ProjectParamsController } = $props();
</script>

<section data-project-params class="card">
  <span data-project-params class="label">{t('params.project')}</span>
  <div data-project-params class="logo-row">
    <ProjectAvatar name={state.p.project.name} logo={state.p.project.logo} />
    <div data-project-params class="logo-texts">
      <div data-project-params class="logo-actions">
        <Button size="sm" onclick={() => void state.pickLogo()}
          ><Icon name="image" size={14} />{t('params.logo.pick')}</Button
        >
        {#if state.p.project.logo}
          <Button size="sm" onclick={() => void state.removeLogo()}
            ><Icon name="close" size={13} stroke={2.2} />{t('params.logo.remove')}</Button
          >
        {/if}
      </div>
      <span data-project-params class="note" class:error={state.logoError !== undefined}
        >{state.logoError ?? t('params.logo.note')}</span
      >
    </div>
  </div>
  <label data-project-params class="field">
    <span data-project-params class="key">{t('params.name')}</span>
    <input
      data-project-params
      value={state.p.project.name}
      data-tip={t('params.name.tip')}
      onchange={(e) => void state.rename(e.currentTarget)}
      onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  </label>
</section>
