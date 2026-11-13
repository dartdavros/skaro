<script lang="ts">
  import { Button, t } from '@skaro/ui';
  import { audit } from './audit.svelte';
  import { background } from '../background/background.svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';
  import './audit-i18n';
  async function open() {
    background.open = true;
    if (!audit.current && !audit.error) await audit.command('c4.auditStart');
  }
</script>

<Button data-c4-audit disabled={audit.busy} onclick={() => void open()}>
  {#if audit.active || audit.busy}<LoadingIndicator size={16} />{/if}{t('c4.audit.title')}
</Button>
