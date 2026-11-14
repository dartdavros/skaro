<script lang="ts">
  import ShutdownScreen from './shutdown/ShutdownScreen.svelte';
  import { createShutdownController } from './shutdown/controller.svelte';
  const shutdown = createShutdownController();
  const loadApp = () => import('./App.svelte');
</script>

{#if shutdown.state}
  <ShutdownScreen state={shutdown.state} time={shutdown.time} slow={shutdown.slow} />
{:else}
  {#await loadApp() then { default: App }}<App />{/await}
{/if}
