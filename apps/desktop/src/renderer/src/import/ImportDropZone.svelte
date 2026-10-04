<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { ImportController } from './import-controller.svelte';
  let { state }: { state: ImportController } = $props();
</script>

<div
  data-import-modal
  class="drop"
  class:over={state.over}
  role="button"
  tabindex="0"
  onclick={() => void state.pick('folder')}
  onkeydown={(e) => e.key === 'Enter' && void state.pick('folder')}
  ondragover={(e) => {
    e.preventDefault();
    state.over = true;
  }}
  ondragleave={() => (state.over = false)}
  ondrop={state.drop}
>
  <span data-import-modal class="drop-icon"><Icon name="import" size={22} stroke={1.7} /></span>
  <span data-import-modal class="drop-text">{t('import.drop')}</span>
  <div data-import-modal class="drop-actions">
    <button
      data-import-modal
      type="button"
      class="small"
      onclick={(e) => {
        e.stopPropagation();
        void state.pick('folder');
      }}>{t('import.pickFolder')}</button
    >
    <button
      data-import-modal
      type="button"
      class="small"
      onclick={(e) => {
        e.stopPropagation();
        void state.pick('files');
      }}>{t('import.pickFiles')}</button
    >
  </div>
</div>
