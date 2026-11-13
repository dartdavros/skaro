<script lang="ts">
  import { Button, t } from '@skaro/ui';
  import { background } from './background.svelte';
  import BackgroundRow from './BackgroundRow.svelte';
  let { onchat }: { onchat?: (project: string, chat: string) => void } = $props();
  const day = (at: number) =>
    new Date(at).toLocaleDateString([], { day: 'numeric', month: 'long', year: 'numeric' });
  const groups = $derived([
    ...Map.groupBy(background.archive, (job) => day(job.endedAt ?? job.startedAt)),
  ]);
</script>

<div class="journal" data-project-journal>
  {#each groups as [date, jobs] (date)}
    <section>
      <h3>{date}</h3>
      {#each jobs as job (job.id)}<BackgroundRow {job} {onchat} />{/each}
    </section>
  {/each}
  {#if !background.archive.length}<p>{t('background.noEvents')}</p>{/if}
  {#if background.nextCursor}<Button
      disabled={background.loading}
      onclick={() => void background.read(true)}>{t('background.more')}</Button
    >{/if}
</div>

<style>
  .journal,
  section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  section + section {
    margin-top: 6px;
  }
  h3,
  p {
    margin: 0;
    color: var(--sk-text-secondary);
    font-size: var(--sk-fs-5);
    font-weight: 500;
  }
</style>
