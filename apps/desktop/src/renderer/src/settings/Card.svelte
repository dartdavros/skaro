<script lang="ts">
  import type { Snippet } from 'svelte';

  /** A section of "Настройки" (Settings mockup): the label and its rows. */
  let { label, id, children }: { label: string; id?: string; children: Snippet } = $props();
</script>

<section class="card" {id}>
  <div class="head"><span class="label">{label}</span></div>
  {@render children()}
</section>

<style>
  .card {
    display: flex;
    flex-direction: column;
    gap: 14px;
    padding: 14px 15px 16px;
    border-radius: 10px;
    background: var(--sk-fill-16);
  }

  .head {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .label {
    font-size: var(--sk-fs-2);
    font-weight: 600;
    letter-spacing: 0.07em;
    text-transform: uppercase;
    color: var(--sk-text-23);
  }

  .card :global(.grid) {
    display: grid;
    grid-template-columns: 150px minmax(0, 1fr);
    gap: 14px 16px;
    align-items: center;
  }

  .card :global(.key) {
    font-size: var(--sk-fs-3);
    color: var(--sk-text-19);
  }
</style>
