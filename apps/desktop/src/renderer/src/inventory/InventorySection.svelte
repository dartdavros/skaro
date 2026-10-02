<script lang="ts">
  import type { Snippet } from 'svelte';

  let { title, note, children }: { title: string; note: string; children: Snippet } = $props();
</script>

<section data-inventory>
  <div data-inventory class="head">
    <h2 data-inventory>{title}</h2>
    <p data-inventory>{note}</p>
  </div>
  {@render children()}
</section>
