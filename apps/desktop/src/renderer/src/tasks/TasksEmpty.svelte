<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  let { onnew }: { onnew: () => void } = $props();
</script>

<div data-task-tasks-screen class="empty">
  <div data-task-tasks-screen class="empty-icon">
    <Icon name="box" size={24} stroke={1.7} color="var(--sk-text-22)" />
  </div>
  <div data-task-tasks-screen class="empty-copy">
    <div data-task-tasks-screen class="empty-title">{t('board.empty.title')}</div>
    <div data-task-tasks-screen class="empty-text">{t('board.empty.text')}</div>
  </div>
  <button data-task-tasks-screen type="button" class="new big" onclick={onnew}
    ><Icon name="plus" size={14} stroke={2.6} />{t('board.new')}</button
  >
</div>
