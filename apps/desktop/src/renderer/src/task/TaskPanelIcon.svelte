<script lang="ts">
  let { expand = false }: { expand?: boolean } = $props();
</script>

<svg
  width="15"
  height="15"
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.9"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <g transform="translate(24 0) scale(-1 1)">
    <rect x="3" y="4" width="18" height="16" rx="2"></rect>
    <path d="M9 4v16"></path>
    <path d={expand ? 'm5.6 10.6 1.4 1.4-1.4 1.4' : 'm6.4 10.6-1.4 1.4 1.4 1.4'}></path>
  </g>
</svg>
