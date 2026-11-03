<script lang="ts">
  import { TextField, t } from '@skaro/ui';
  import '../settings/models/i18n';
  let { value = $bindable() }: { value?: number } = $props();
</script>

<div class="section">
  <TextField
    label={t('models.optionalBudget')}
    inputmode="decimal"
    bind:value={
      () => (value === undefined ? '' : String(value)),
      (text) => {
        value = text.trim() ? Number(text) : undefined;
      }
    }
  />
</div>
