<script lang="ts">
  import { i18n, Segmented, setLocale, t, type Locale } from '@skaro/ui';
  import Row from './Row.svelte';
  import Section from './Section.svelte';
  import { applyFeedFont, Setting } from './setting.svelte';

  /** "Внешний вид": the interface language and the font of the agent feed. */
  const font = new Setting<string>('ui.feedFont', 'normal');

  function setLanguage(locale: Locale): void {
    if (locale === i18n.locale) return;
    setLocale(locale);
    void window.skaro.invoke('app.setLocale', locale);
  }

  function setFont(size: string): void {
    font.set(size);
    applyFeedFont(size);
  }
</script>

<Section title={t('settings.appearance')}>
  <Row title={t('settings.language')}>
    <Segmented
      label={t('settings.language')}
      bind:value={() => i18n.locale, setLanguage}
      options={[
        { value: 'ru', label: 'Русский' },
        { value: 'en', label: 'English' },
      ]}
    />
  </Row>
  <Row title={t('settings.font')}>
    <Segmented
      label={t('settings.font')}
      bind:value={() => font.value, setFont}
      options={[
        { value: 'small', label: t('settings.font.small') },
        { value: 'normal', label: t('settings.font.normal') },
        { value: 'large', label: t('settings.font.large') },
      ]}
    />
  </Row>
</Section>
