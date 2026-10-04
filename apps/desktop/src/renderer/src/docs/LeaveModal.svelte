<script lang="ts">
  import { t } from '@skaro/ui';

  /** "Отменить изменения?" (Documents mockup): leaving a document with unsaved edits. */
  let { title, ondiscard, onstay }: { title: string; ondiscard: () => void; onstay: () => void } =
    $props();
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && onstay()} />

<div class="backdrop" role="presentation" onclick={onstay}>
  <div
    class="dialog"
    role="alertdialog"
    aria-modal="true"
    tabindex="-1"
    onclick={(e) => e.stopPropagation()}
    onkeydown={() => undefined}
  >
    <div class="texts">
      <span class="title">{t('docs.leave.title')}</span>
      <span class="text">{t('docs.leave.text', { title })}</span>
    </div>
    <div class="footer">
      <button type="button" class="stay" onclick={onstay}>{t('docs.leave.stay')}</button>
      <button type="button" class="discard" onclick={ondiscard}>{t('docs.leave.discard')}</button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    background: var(--sk-black-a55);
    backdrop-filter: blur(3px);
  }

  .dialog {
    width: 400px;
    max-width: 100%;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 20px;
    border-radius: 14px;
    background: var(--sk-fill-11);
    box-shadow: 0 30px 80px var(--sk-black-a60),
      0 0 0 1px var(--sk-white-a4);
    outline: none;
  }

  .texts {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .title {
    font-size: var(--sk-fs-10);
    font-weight: 700;
    color: var(--sk-text-6);
  }

  .text {
    font-size: var(--sk-fs-6);
    line-height: 1.55;
    color: var(--sk-text-19);
    text-wrap: pretty;
  }

  .footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }

  .stay,
  .discard {
    height: 34px;
    border: none;
    border-radius: 8px;
    font-size: var(--sk-fs-6);
    cursor: pointer;
  }

  .stay {
    padding: 0 14px;
    background: var(--sk-fill-20);
    color: var(--sk-text-6);
    font-weight: 600;
  }

  .stay:hover {
    background: var(--sk-fill-27);
    color: var(--sk-text-2);
  }

  .discard {
    padding: 0 15px;
    background: var(--sk-red-6);
    color: var(--sk-text-1);
    font-weight: 700;
  }

  .discard:hover {
    background: var(--sk-red-5);
  }
</style>
