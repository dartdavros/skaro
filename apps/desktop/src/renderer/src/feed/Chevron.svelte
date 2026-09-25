<script lang="ts">
  import { Icon } from '@skaro/ui';

  /** The small arrow of foldable feed lines. */
  let { open = false, color }: { open?: boolean; color?: string } = $props();
</script>

<span class="fd-chevron" class:open>
  <Icon name="chevronRight" size={12} stroke={2} {...color ? { color } : {}} />
</span>
