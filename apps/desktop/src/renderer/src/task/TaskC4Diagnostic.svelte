<script lang="ts">
  import { Banner, t } from '@skaro/ui';
  import type { TaskController } from './task-controller.svelte';
  import './c4-diagnostic-i18n';

  let { controller }: { controller: TaskController } = $props();
  const view = $derived(controller.view);
  const diagnostic = $derived(view?.c4Diagnostic);
  const issue = $derived(diagnostic?.issues[0]);
  const timeline = $derived(controller.timeline);
  const canContinue = $derived(
    !timeline?.interactions.length &&
      !timeline?.items.some(
        (item) =>
          item.kind === 'proposal' && (item.state === 'pending' || item.state === 'accepted'),
      ),
  );
  const text = $derived(
    issue
      ? [
          issue.ids.join(', '),
          issue.path,
          t(`c4.diagnostic.${issue.code}`),
          (diagnostic?.issues.length ?? 0) > 1
            ? t('c4.diagnostic.more', { n: (diagnostic?.issues.length ?? 0) - 1 })
            : '',
        ]
          .filter(Boolean)
          .join(' ')
      : '',
  );
</script>

{#if diagnostic && !controller.running && !view?.queued}
  <div class="diagnostic" data-c4-diagnostic={diagnostic.stage}>
    <Banner
      kind="warning"
      title={t('c4.diagnostic.title')}
      text={' ' + text}
      action={canContinue ? t('c4.diagnostic.continue') : undefined}
      onaction={() =>
        void controller.send({ text: t('c4.diagnostic.message') }).catch(() => undefined)}
    />
  </div>
{/if}

<style>
  .diagnostic {
    width: 100%;
    max-width: 744px;
    margin-inline: auto;
  }
  .diagnostic :global(.body) {
    overflow-wrap: anywhere;
  }
</style>
