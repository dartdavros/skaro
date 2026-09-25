<script lang="ts">
  import { t } from '@skaro/ui';

  let { title, stage }: { title: string; stage: number } = $props();
</script>

<div class="placeholder">
  <h1 class="sk-title">{title}</h1>
  <div class="card">
    <span class="sk-name">{t('placeholder.title')}</span>
    <span class="sk-secondary">{t('placeholder.stage', { stage })}</span>
  </div>
</div>

<style>
  .placeholder {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    max-width: 520px;
    padding: 16px 18px;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface);
  }
</style>
