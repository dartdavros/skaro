<script lang="ts">
  /** The project tile ("Проекты", "Параметры проекта"): its logo, else coloured initials. */
  let {
    name,
    logo,
    small = false,
  }: { name: string; logo?: string | undefined; small?: boolean } = $props();

  const AVATARS = [
    ['var(--sk-fill-21)', 'var(--sk-warn)'],
    ['var(--sk-fill-21)', 'var(--sk-blue-3)'],
    ['var(--sk-fill-21)', 'var(--sk-red-3)'],
    ['var(--sk-fill-21)', 'var(--sk-green-1)'],
    ['var(--sk-fill-21)', 'var(--sk-purple-1)'],
    ['var(--sk-fill-24)', 'var(--sk-text-12)'],
  ] as const;

  const colors = $derived.by(() => {
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    return AVATARS[hash % AVATARS.length]!;
  });
  const initials = $derived(
    name
      .split(/[\s_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase(),
  );
</script>

{#if logo}
  <img class="avatar" class:small src={logo} alt="" />
{:else}
  <div class="avatar" class:small style="background: {colors[0]}; color: {colors[1]}">
    {initials}
  </div>
{/if}

<style>
  .avatar {
    flex: none;
    width: 34px;
    height: 34px;
    border-radius: 9px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: var(--sk-mono);
    font-size: var(--sk-fs-5);
    font-weight: 600;
  }

  img.avatar {
    object-fit: contain;
  }

  .avatar.small {
    width: 26px;
    height: 26px;
    border-radius: 7px;
    font-size: var(--sk-fs-2);
  }
</style>
