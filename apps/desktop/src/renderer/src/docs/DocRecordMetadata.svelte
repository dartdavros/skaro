<script lang="ts">
  import { Icon, Popover, t } from '@skaro/ui';
  import { ADR_STATUS, SPEC_STATUS, adrDate, codeOf, recordOf } from './model';
  import type { HeaderProps } from './header-props';
  let {
    doc,
    adr,
    isSpec,
    menu = $bindable(false),
    onstatus,
    onadr,
  }: Pick<HeaderProps, 'doc' | 'onstatus' | 'onadr'> & {
    adr: NonNullable<ReturnType<typeof recordOf>>;
    isSpec: boolean;
    menu: boolean;
  } = $props();
  const STATUS = $derived(isSpec ? SPEC_STATUS : ADR_STATUS);
</script>

<div data-doc-header class="adr">
  <Popover bind:open={menu} width={200} offset={32}>
    {#snippet trigger({ toggle })}
      <button
        data-doc-header
        type="button"
        class="status"
        class:open={menu}
        data-tip={isSpec ? t('docs.spec.status.tip') : t('docs.adr.status.tip')}
        onclick={toggle}
      >
        <span data-doc-header class="dot" style="background: {STATUS[adr.status].dot}"></span>
        {t(STATUS[adr.status].label)}
        <span data-doc-header class="chev"><Icon name="chevronDown" size={11} stroke={2.4} /></span>
      </button>
    {/snippet}
    {#snippet children({ close })}
      {#each ['proposed', 'accepted', 'superseded'] as const as s (s)}
        <div
          data-doc-header
          class="opt"
          class:on={adr.status === s}
          role="menuitemradio"
          aria-checked={adr.status === s}
          tabindex="-1"
          onclick={() => {
            close();
            onstatus(s);
          }}
          onkeydown={(e) => e.key === 'Enter' && onstatus(s)}
        >
          <span data-doc-header class="dot" style="background: {STATUS[s].dot}"></span>
          <span data-doc-header class="opt-label">{t(STATUS[s].label)}</span>
          <span data-doc-header class="check" class:on={adr.status === s}
            ><Icon name="check" size={13} stroke={2.6} /></span
          >
        </div>
      {/each}
    {/snippet}
  </Popover>
  {#if adr.date}<span data-doc-header class="muted">{adrDate(adr.date)}</span>{/if}
  {#if adr.replaces}
    <span data-doc-header class="muted"
      >{t('docs.adr.replaces')}
      <a
        data-doc-header
        href="#{adr.replaces}"
        onclick={(e) => (e.preventDefault(), onadr(adr.replaces!))}>{codeOf(doc, adr.replaces)}</a
      ></span
    >
  {/if}
  {#if adr.status === 'superseded' && adr.replacedBy}
    <span data-doc-header class="muted"
      >{isSpec ? t('docs.spec.replacedBy') : t('docs.adr.replacedBy')}
      <a
        data-doc-header
        href="#{adr.replacedBy}"
        onclick={(e) => (e.preventDefault(), onadr(adr.replacedBy!))}
        >{codeOf(doc, adr.replacedBy)}</a
      ></span
    >
  {/if}
</div>
