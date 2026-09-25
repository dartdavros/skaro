<script lang="ts">
  import type { Interaction } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import { useFeed } from './context.svelte';

  /**
   * Agent question (mockups 3a–3f): 1–4 questions as steps, a header chip, options with notes,
   * multiple choice, "own answer" per question, secret input, option preview.
   */
  let { interaction }: { interaction: Extract<Interaction, { kind: 'question' }> } = $props();

  const feed = useFeed();
  let step = $state(0);
  let picked = $state<Record<string, string[]>>({});
  let custom = $state<Record<string, string>>({});
  let customOn = $state<Record<string, boolean>>({});
  let reveal = $state(false);
  let sending = $state(false);

  const questions = $derived(interaction.questions);
  const q = $derived(questions[Math.min(step, questions.length - 1)]!);

  function answerOf(id: string): string[] {
    const question = questions.find((x) => x.id === id);
    const values = [...(picked[id] ?? [])];
    const own = custom[id]?.trim();
    if (own && (customOn[id] || !question?.options.length)) values.push(own);
    return values;
  }

  const ready = $derived(questions.every((x) => answerOf(x.id).length > 0));

  function choose(label: string): void {
    const current = picked[q.id] ?? [];
    if (q.multi) {
      picked[q.id] = current.includes(label)
        ? current.filter((l) => l !== label)
        : [...current, label];
    } else {
      picked[q.id] = [label];
      customOn[q.id] = false;
    }
  }

  function toggleCustom(): void {
    if (q.multi) customOn[q.id] = !customOn[q.id];
    else {
      customOn[q.id] = true;
      picked[q.id] = [];
    }
  }

  async function send(): Promise<void> {
    if (!ready || sending) return;
    sending = true;
    try {
      await feed.respond(interaction.id, {
        kind: 'question',
        answers: Object.fromEntries(questions.map((x) => [x.id, answerOf(x.id)])),
      });
    } finally {
      sending = false;
    }
  }

  const preview = $derived(
    q.options.find((o) => (picked[q.id] ?? []).includes(o.label))?.preview ??
      q.options.find((o) => o.preview)?.preview,
  );
</script>

<div class="fd-card">
  <div class="head">
    <span class="fd-label" style="flex: 1">{q.header}</span>
    {#if questions.length > 1}
      <span class="step">{t('card.question.step', { i: step + 1, n: questions.length })}</span>
      <button
        type="button"
        class="nav"
        disabled={step === 0}
        data-tip={t('card.question.prev')}
        aria-label={t('card.question.prev')}
        onclick={() => (step -= 1)}
      >
        <Icon name="chevronLeft" size={12} stroke={2.4} />
      </button>
      <button
        type="button"
        class="nav"
        disabled={step >= questions.length - 1}
        data-tip={t('card.question.next')}
        aria-label={t('card.question.next')}
        onclick={() => (step += 1)}
      >
        <Icon name="chevronRight" size={12} stroke={2.4} />
      </button>
    {/if}
  </div>
  <div class="fd-card-q">{q.text}</div>

  {#if q.secret}
    <div class="secret">
      <input
        class="fd-input"
        type={reveal ? 'text' : 'password'}
        autocomplete="off"
        bind:value={custom[q.id]}
        onkeydown={(e) => e.key === 'Enter' && void send()}
      />
      <button
        type="button"
        class="eye"
        data-tip={reveal ? t('card.question.hide') : t('card.question.show')}
        onclick={() => (reveal = !reveal)}
      >
        <Icon name={reveal ? 'eyeOff' : 'eye'} size={15} stroke={1.9} />
      </button>
    </div>
  {:else}
    <div class="options">
      {#each q.options as option (option.label)}
        {@const on = (picked[q.id] ?? []).includes(option.label)}
        <button type="button" class="fd-option" class:on onclick={() => choose(option.label)}>
          {#if q.multi}
            <span class="fd-check"><Icon name="check" size={11} stroke={3.2} /></span>
          {:else}
            <span class="fd-radio"></span>
          {/if}
          <span class="texts">
            <span class="title">{option.label}</span>
            {#if option.description}<span class="note">{option.description}</span>{/if}
          </span>
        </button>
      {/each}
      {#if q.allowFreeText || !q.options.length}
        <div class="custom" class:on={customOn[q.id] || !q.options.length}>
          {#if q.options.length}
            <button
              type="button"
              class="custom-mark"
              aria-label={t('card.question.custom')}
              onclick={toggleCustom}
            >
              {#if q.multi}
                <span class="fd-check" class:on={customOn[q.id]}
                  ><Icon name="check" size={11} stroke={3.2} /></span
                >
              {:else}
                <span class="fd-radio" class:on={customOn[q.id]}></span>
              {/if}
            </button>
          {/if}
          <input
            class="fd-input"
            style="height: 30px"
            placeholder={t('card.question.custom')}
            bind:value={custom[q.id]}
            oninput={() => {
              const has = (custom[q.id] ?? '').trim().length > 0;
              if (has && !customOn[q.id]) {
                customOn[q.id] = true;
                if (!q.multi) picked[q.id] = [];
              }
            }}
          />
        </div>
      {/if}
    </div>
  {/if}

  {#if preview}
    <pre class="preview">{preview}</pre>
  {/if}

  <div class="fd-card-foot">
    <span class="hint">{t('card.question.hint')}</span>
    <button
      type="button"
      class="fd-btn primary"
      disabled={!ready || sending}
      data-tip={ready ? t('card.question.answerTip') : t('card.question.notReady')}
      onclick={() => void send()}>{t('card.question.answer')}</button
    >
  </div>
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 22px;
  }

  .step {
    font-family: var(--sk-mono);
    font-size: 11.5px;
    color: #8a8a8a;
  }

  .nav {
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #a6a6a6;
    cursor: pointer;
    padding: 0;
  }

  .nav:hover:not(:disabled) {
    background: #242424;
  }

  .nav:disabled {
    color: #3b3b3b;
    cursor: default;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .custom {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 8px;
  }

  .custom.on {
    background: #1c1c1c;
  }

  .custom-mark {
    flex: none;
    display: inline-flex;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }

  .custom-mark .fd-radio,
  .custom-mark .fd-check {
    margin-top: 0;
  }

  .secret {
    position: relative;
    display: flex;
  }

  .secret .fd-input {
    height: 34px;
    padding-right: 40px;
    font-family: var(--sk-mono);
  }

  .eye {
    position: absolute;
    right: 4px;
    top: 4px;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #7d7d7d;
    cursor: pointer;
    padding: 0;
  }

  .eye:hover {
    background: #1e1e1e;
    color: #d5d5d5;
  }

  .preview {
    margin: 0;
    padding: 10px 12px;
    border-radius: 8px;
    background: #0f0f0f;
    font-family: var(--sk-mono);
    font-size: 12px;
    line-height: 1.6;
    color: #a6a6a6;
    white-space: pre-wrap;
    max-height: 220px;
    overflow: auto;
  }
</style>
