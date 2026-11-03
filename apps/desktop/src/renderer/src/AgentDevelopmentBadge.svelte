<script lang="ts">
  import { t } from '@skaro/ui';
  import './settings/models/i18n';
</script>

<span class="development-badge">{t('models.inDevelopment')}</span>

<style>
  .development-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 6px;
    border-radius: 5px;
    background: var(--sk-fill-20);
    color: var(--sk-text-17);
    font-size: var(--sk-fs-2);
    font-weight: 600;
    line-height: 1.4;
    white-space: nowrap;
  }
</style>
