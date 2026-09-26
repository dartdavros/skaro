<script lang="ts">
  /** A switch with its label and note (ProjectSettings mockup). */
  let {
    checked,
    label,
    note,
    onchange,
  }: { checked: boolean; label: string; note: string; onchange: (on: boolean) => void } = $props();
</script>

<button
  type="button"
  class="row"
  role="switch"
  aria-checked={checked}
  onclick={() => onchange(!checked)}
>
  <span class="track" class:on={checked}><span class="knob"></span></span>
  <span class="texts">
    <span class="label">{label}</span>
    <span class="note">{note}</span>
  </span>
</button>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 9px 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .row:hover {
    background: var(--sk-fill-13);
  }

  .track {
    flex: none;
    width: 34px;
    height: 19px;
    border-radius: 10px;
    background: var(--sk-fill-26);
    display: flex;
    align-items: center;
    padding: 2px;
    justify-content: flex-start;
  }

  .track.on {
    background: var(--sk-accent);
    justify-content: flex-end;
  }

  .knob {
    width: 15px;
    height: 15px;
    border-radius: 50%;
    background: var(--sk-fill-39);
  }

  .on .knob {
    background: var(--sk-fill-42);
  }

  .texts {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .label {
    font-size: var(--sk-fs-5);
    font-weight: 600;
    color: var(--sk-text-7);
  }

  .note {
    font-size: var(--sk-fs-3);
    line-height: 1.45;
    color: var(--sk-text-21);
    text-wrap: pretty;
  }
</style>
