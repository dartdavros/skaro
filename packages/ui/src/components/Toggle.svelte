<script lang="ts">
  /** A single on/off setting: 32×18, on — blue. Multiple choices use Segmented. */
  let {
    checked = $bindable(false),
    label,
    disabled = false,
  }: { checked?: boolean; label?: string; disabled?: boolean } = $props();
</script>

<button
  type="button"
  role="switch"
  aria-checked={checked}
  class="row"
  class:plain={!label}
  {disabled}
  onclick={() => (checked = !checked)}
>
  {#if label}<span class="label">{label}</span>{/if}
  <span class="switch" class:on={checked}><span class="knob"></span></span>
</button>

<style>
  .row {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    text-align: left;
    cursor: pointer;
  }

  .row.plain {
    width: auto;
  }

  .row:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .label {
    flex: 1;
    font-size: 13px;
    color: #c8c8c8;
  }

  .switch {
    flex: none;
    position: relative;
    width: 32px;
    height: 18px;
    border-radius: 999px;
    background: #383838;
    transition: background 0.15s;
  }

  .switch.on {
    background: var(--sk-accent);
  }

  .knob {
    position: absolute;
    top: 2px;
    left: 2px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--sk-text-bright);
    transition: left 0.15s;
  }

  .on .knob {
    left: 16px;
  }
</style>
