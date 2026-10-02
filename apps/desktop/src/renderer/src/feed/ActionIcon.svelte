<script lang="ts">
  import { File, Globe, Pencil, SquareTerminal, Wifi } from '@lucide/svelte';
  import type { ActionKind } from '@skaro/timeline';

  let { kind, size = 14 }: { kind: ActionKind; size?: number } = $props();
  const IconComponent = $derived(
    kind === 'file'
      ? Pencil
      : kind === 'reconnect'
        ? Wifi
        : ['search', 'web', 'fetch'].includes(kind)
          ? Globe
          : ['read', 'list', 'image', 'generated'].includes(kind)
            ? File
            : SquareTerminal,
  );
</script>

<span class="fd-action-icon" data-action-icon={kind} aria-hidden="true">
  <IconComponent {size} strokeWidth={1.8} />
</span>
