<script lang="ts">
  import { t } from '@skaro/ui';
  import ProjectIdentity from './ProjectIdentity.svelte';
  import ProjectRemoval from './ProjectRemoval.svelte';
  import AgentDefaults from './AgentDefaults.svelte';
  import ProjectRules from './ProjectRules.svelte';
  import './i18n';
  import type { ProjectParamsProps } from './project-params-props';
  import { createProjectParamsController } from './project-params-controller.svelte';
  let { project, onremove, onchanged }: ProjectParamsProps = $props();
  const state = createProjectParamsController({
    get project() {
      return project;
    },
    get onremove() {
      return onremove;
    },
    get onchanged() {
      return onchanged;
    },
  });

  import './project-params.css';
</script>

<div data-project-params class="screen">
  <div data-project-params class="head">
    <div data-project-params class="inner">
      <div data-project-params class="titles">
        <span data-project-params class="title">{t('params.title')}</span>
        <span data-project-params class="subtitle"
          >{t('params.subtitle', { name: project.name })}</span
        >
      </div>
      <span data-project-params class="spacer"></span>
      <span data-project-params class="saved" data-tip={t('params.saved.tip')}
        >{t('params.saved')}</span
      >
    </div>
  </div>
  {#if state.settings}
    <div data-project-params class="scroll">
      <div data-project-params class="inner cards">
        <ProjectIdentity {state} />

        <section data-project-params class="card">
          <span data-project-params class="label">{t('params.agent')}</span>
          <AgentDefaults projectId={project.id} settings={state.settings} onchange={state.change} />
        </section>

        <ProjectRules
          value={state.settings}
          instructionsNote={t('params.instructions.note')}
          onchange={state.change}
        />

        <ProjectRemoval onremove={state.remove} />
      </div>
    </div>
  {/if}
</div>
