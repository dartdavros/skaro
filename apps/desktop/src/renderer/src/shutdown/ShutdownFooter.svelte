<script lang="ts">
  import { Button, t } from '@skaro/ui';
  let exiting = $state(false);
  async function finishNow(): Promise<void> {
    if (exiting) return;
    exiting = true;
    try {
      await window.skaro.invoke('app.shutdownNow');
    } catch {
      // A rejected request can be retried; a successful one closes the renderer itself.
      exiting = false;
    }
  }
</script>

<footer class="shutdown-footer">
  <Button variant="secondary" size="sm" disabled={exiting} onclick={finishNow}>
    {t('shutdown.now')}
  </Button>
  <p>{t('shutdown.automatic')}</p>
</footer>

<style>
  .shutdown-footer {
    position: absolute;
    bottom: 24px;
    left: 16px;
    right: 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
  }
  p {
    margin: 0;
    color: var(--shutdown-dim);
    font-size: var(--sk-fs-4);
  }
</style>
