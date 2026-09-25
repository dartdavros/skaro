<script lang="ts">
  /** The Skaro mark (docs/mockups/assets/mark.svg). */
  let { size = 16 }: { size?: number } = $props();
  const id = `skGrad${Math.random().toString(36).slice(2, 8)}`;
</script>

<svg width={size} height={size} viewBox="0 0 127 127" aria-hidden="true">
  <defs>
    <linearGradient {id} x1="0%" x2="0%" y1="100%" y2="0%">
      <stop offset="0%" stop-color="rgb(129,0,70)" />
      <stop offset="16%" stop-color="rgb(168,0,40)" />
      <stop offset="32%" stop-color="rgb(232,0,44)" />
      <stop offset="48%" stop-color="rgb(255,0,0)" />
      <stop offset="64%" stop-color="rgb(255,66,0)" />
      <stop offset="81%" stop-color="rgb(255,84,0)" />
      <stop offset="99%" stop-color="rgb(255,90,0)" />
    </linearGradient>
  </defs>
  <path
    fill-rule="evenodd"
    fill="url(#{id})"
    d="M63.500,126.999 C28.429,126.999 0.0,98.570 0.0,63.500 C0.0,59.33 0.466,54.677 1.343,50.471 C5.174,62.937 16.778,72.0 30.500,72.0 C47.344,72.0 60.999,58.344 60.999,41.500 C60.999,24.655 47.344,11.0 30.500,11.0 C29.513,11.0 28.539,11.51 27.577,11.142 C37.795,4.118 50.164,0.0 63.500,0.0 C98.570,0.0 126.999,28.429 126.999,63.500 C126.999,98.570 98.570,126.999 63.500,126.999 Z"
  />
</svg>

<style>
  svg {
    flex: none;
    display: block;
  }
</style>
