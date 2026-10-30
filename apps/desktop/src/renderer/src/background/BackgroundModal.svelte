<script lang="ts">
  import { Button, Modal, Progress, t } from '@skaro/ui';
  import BackgroundRow from './BackgroundRow.svelte';
  import { background } from './background.svelte';
  import './i18n';
</script>

<Modal
  bind:open={background.open}
  title={t('background.title')}
  subtitle={t('background.subtitle')}
  width={720}
>
  <!-- The list scrolls inside: the title and the close button always stay on screen. -->
  <div class="jobs">
    {#if !background.jobs.length}
      <p class="empty">{t('background.empty')}</p>
    {/if}
    {#if background.running.length}
      <section>
        <h3>{t('background.running')}</h3>
        {#each background.running as job (job.id)}
          <BackgroundRow {job} />
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
          <BackgroundRow {job} />
        {/each}
      </section>
    {/if}
  </div>
  {#snippet footer()}
    <Button onclick={() => (background.open = false)}>{t('background.close')}</Button>
  {/snippet}
</Modal>

<style>
  .jobs {
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
