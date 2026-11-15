<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ResourceWait } from '../../../shared/resource-wait';
  import { resourceWaitLabel, resourceWaitAmount, resourceWaitDetail } from '../resource-wait';

  let { after, resourceWait }: { after?: string; resourceWait?: ResourceWait } = $props();
</script>

<div class="empty">
  <Icon name="clock" size={30} stroke={1.5} color="var(--sk-text-29)" />
  <span class="empty-text" data-tip={resourceWait && resourceWaitDetail(resourceWait)}>
    {#if resourceWait}
      {resourceWaitLabel(resourceWait)}{#if resourceWaitAmount(resourceWait)}
        · {resourceWaitAmount(resourceWait)}{/if}
    {:else if after}{t('task.queued.stage')} <span class="mono">{after}</span>
    {:else}{t('task.status.queued')}{/if}
  </span>
</div>
