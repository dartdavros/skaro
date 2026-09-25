<script lang="ts">
  import { Button, i18n, Segmented, setLocale, t, type Locale } from '@skaro/ui';

  /** Global settings — only the language for now; the full screen arrives in stage 7. */
  let { oninventory }: { oninventory: () => void } = $props();

  let locale = $state<Locale>(i18n.locale);

  $effect(() => {
    if (locale === i18n.locale) return;
    setLocale(locale);
    void window.skaro.invoke('app.setLocale', locale);
  });
</script>

<div class="settings">
  <h1 class="sk-title">{t('settings.title')}</h1>
  <section class="card">
    <span class="sk-label">{t('settings.language')}</span>
    <Segmented
      bind:value={locale}
      label={t('settings.language')}
      options={[
        { value: 'ru', label: 'Русский' },
        { value: 'en', label: 'English' },
      ]}
    />
  </section>
  <section class="card">
    <span class="sk-label">{t('settings.developer')}</span>
    <span class="sk-secondary">{t('settings.inventory.note')}</span>
    <div><Button onclick={oninventory}>{t('settings.inventory')}</Button></div>
  </section>
</div>

<style>
  .settings {
    display: flex;
    flex-direction: column;
    gap: 18px;
    max-width: 640px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 16px 18px;
    border-radius: var(--sk-radius-card);
    background: var(--sk-surface);
  }
</style>
