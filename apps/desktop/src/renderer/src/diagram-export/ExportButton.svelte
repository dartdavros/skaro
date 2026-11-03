<script lang="ts">
  import { Download } from '@lucide/svelte';
  import { IconButton, t } from '@skaro/ui';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import './i18n';
  let {
    busy = false,
    disabled = false,
    onclick,
  }: { busy?: boolean; disabled?: boolean; onclick: () => void } = $props();
</script>

<IconButton
  tip={t(busy ? 'export.busy' : 'export.png')}
  disabled={disabled || busy}
  {onclick}
  aria-busy={busy}
>
  {#if busy}<LoadingIndicator size={16} />{:else}<Download size={16} />{/if}
</IconButton>
