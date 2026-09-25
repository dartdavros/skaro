<script lang="ts">
  import { icons, type IconName } from '../icons.ts';

  let {
    name,
    size = 16,
    stroke = 1.8,
    color = 'currentColor',
  }: { name: IconName; size?: number; stroke?: number; color?: string } = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke={color}
  stroke-width={stroke}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={icons[name]} />
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>
