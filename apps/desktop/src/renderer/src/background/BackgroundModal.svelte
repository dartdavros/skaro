<script lang="ts">
  import { Banner, Button, Modal, Progress, t } from '@skaro/ui';
  import { History, RotateCw, X } from '@lucide/svelte';
  import { audit } from '../c4/audit.svelte';
  import BackgroundRow from './BackgroundRow.svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import { decisions } from '../decisions/decisions.svelte';
  import BackgroundJournal from './BackgroundJournal.svelte';
  import { background } from './background.svelte';
  import './i18n';
  let { onchat }: { onchat?: (project: string, chat: string) => void } = $props();
  $effect(() => background.scope(decisions.project?.id));
</script>

<Modal
  projectScoped={!!decisions.project}
  bind:open={background.open}
  title={t(background.journal ? 'background.journal' : 'background.title')}
  subtitle={decisions.project
    ? `${decisions.project.name} · ${t(background.journal ? 'background.journalSubtitle' : 'background.recentSubtitle')}`
    : t('background.subtitle')}
  width={720}
>
  <!-- The list scrolls inside: the title and the close button always stay on screen. -->
  <div class="jobs" aria-busy={background.loading}>
    {#if audit.error && !audit.current}<Banner kind="error" text={audit.error} />{/if}
    {#if background.loading && !background.archive.length}<div class="center">
        <LoadingIndicator /><span>{t('background.loading')}</span>
      </div>
    {:else if background.error}<div class="center">
        <span>{t('background.loadError')}</span><Button onclick={() => void background.read()}
          ><RotateCw size={16} />{t('background.retry')}</Button
        >
      </div>
    {:else if background.journal}<BackgroundJournal {onchat} />
    {:else}
      {#if !background.jobs.length}
        <p class="empty">{t('background.empty')}</p>
      {/if}
      {#if background.running.length}
        <section>
          <h3>{t('background.running')}</h3>
          {#each background.running as job (job.id)}
            <BackgroundRow {job} {onchat} />
            {#if job.progress !== undefined}
              <Progress
                done={job.progress}
                total={100}
                accessibleLabel={t(`background.job.${job.what}`, job.params)}
              />
            {/if}
          {/each}
        </section>
      {/if}
      {#if background.recent.length}
        <section>
          <h3>{t('background.recent')}</h3>
          {#each background.recent as job (job.id)}
            <BackgroundRow {job} {onchat} />
          {/each}
        </section>
      {/if}
    {/if}
  </div>
  {#snippet footer()}
    {#if decisions.project}<button
        class="journal-link"
        onclick={() => (background.journal ? background.recentView() : background.history())}
        ><History size={16} />{t(
          background.journal ? 'background.recentView' : 'background.journal',
        )}</button
      >{/if}
    <Button onclick={() => (background.open = false)}><X size={16} />{t('background.close')}</Button
    >
  {/snippet}
</Modal>

<style>
  .journal-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-right: auto;
    padding: 0;
    border: none;
    background: none;
    color: var(--sk-link);
    font: inherit;
    font-size: var(--sk-fs-4);
    cursor: pointer;
  }
  .center {
    min-height: 280px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--sk-text-muted);
  }

  .jobs {
    min-height: min(280px, calc(100dvh - 240px));
    max-height: min(60vh, 520px);
    overflow-y: auto;
    padding-right: 6px;
  }
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  section + section {
    margin-top: 18px;
  }
  h3 {
    margin: 0;
    font-size: var(--sk-fs-5);
    font-weight: 500;
    color: var(--sk-text-secondary);
  }
  .empty {
    margin: 0;
    font-size: var(--sk-fs-6);
    color: var(--sk-text-secondary);
  }
</style>
