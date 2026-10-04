<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { PlanController } from './plan-controller.svelte';
  let { model }: { model: PlanController } = $props();
</script>

<div data-plan-screen class="empty">
  <span data-plan-screen class="empty-icon"><Icon name="plan" size={30} stroke={1.5} /></span>
  <div data-plan-screen class="empty-copy">
    <span data-plan-screen class="empty-title">{t('plan.empty.title')}</span>
    <span data-plan-screen class="empty-text">{t('plan.empty.text')}</span>
  </div>
  <button data-plan-screen type="button" class="primary big" onclick={model.p.onchat}
    ><Icon name="chat" size={14} stroke={2} />{t('plan.discuss')}</button
  >
</div>
