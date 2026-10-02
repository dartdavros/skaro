<script lang="ts">
  import InventorySection from './InventorySection.svelte';
  import { swatches } from './data';
</script>

<InventorySection
  title="01 · Цвета"
  note="Акцент — синий, только для кликабельного и «требует внимания». Код и команды подсвечиваются тем же светлым синим, что и ссылки. Зелёный — только «+» в диффе."
>
  <div data-inventory class="swatches">
    {#each swatches as [name, hex] (hex)}
      <button
        data-inventory
        type="button"
        class="swatch"
        data-tip={`Скопировать ${hex}`}
        onclick={() => navigator.clipboard?.writeText(hex)}
      >
        <span data-inventory class="chip" style="background: {hex}"></span>
        <span data-inventory class="swatch-name">{name}</span>
        <span data-inventory class="swatch-hex">{hex}</span>
      </button>
    {/each}
  </div>
</InventorySection>
