<script lang="ts">
  import { Button, t } from '@skaro/ui';
  import { Download } from '@lucide/svelte';
  import type { C4Model } from '@skaro/core/c4-view';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import { c4Png } from './export-png';
  import { exportName } from '../diagram-export/image';
  import '../diagram-export/i18n';
  let { model, onerror }: { model: C4Model; onerror: (error: string) => void } = $props();
  let busy = $state(false),
    button: HTMLSpanElement;
  async function exportAll(): Promise<void> {
    if (busy) return;
    busy = true;
    const snapshot = model;
    let token: string | null = null,
      saved = 0;
    onerror('');
    try {
      token = await window.skaro.invoke('diagram.pickFolder');
      if (!token) return;
      for (const [index, view] of snapshot.views.entries()) {
        const bytes = await c4Png(snapshot, view, button);
        const name = `${exportName(String(index + 1).padStart(3, '0'), view.id, view.state, `r${snapshot.revision}`)}.png`;
        await window.skaro.invoke('diagram.saveInFolder', token, name, bytes);
        saved++;
      }
    } catch {
      onerror(t('export.batchFailed', { n: saved, reason: t('export.c4Failed') }));
    } finally {
      if (token) await window.skaro.invoke('diagram.closeFolder', token).catch(() => undefined);
      busy = false;
    }
  }
</script>

<span bind:this={button}>
  <Button
    size="sm"
    disabled={busy || !model.views.length}
    aria-busy={busy}
    onclick={() => void exportAll()}
  >
    {#if busy}<LoadingIndicator size={15} />{:else}<Download size={15} />{/if}
    {t('export.allC4')}
  </Button>
</span>
