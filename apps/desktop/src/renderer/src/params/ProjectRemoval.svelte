<script lang="ts">
  import { t } from '@skaro/ui';
  let { onremove }: { onremove: () => void } = $props();
</script>

<section data-project-params class="card remove">
  <div data-project-params class="remove-texts">
    <span data-project-params class="remove-title">{t('params.remove')}</span>
    <span data-project-params class="note">{t('params.remove.note')}</span>
  </div>
  <button
    data-project-params
    type="button"
    class="remove-btn"
    data-tip={t('params.remove.tip')}
    onclick={onremove}>{t('params.remove.action')}</button
  >
</section>
