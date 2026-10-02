<script lang="ts">
  import { AgentLogo, Button, Modal, Segmented } from '@skaro/ui';

  let { open = $bindable() }: { open: boolean } = $props();

  let agent = $state<'claude-code' | 'codex'>('claude-code');
  let effort = $state<'low' | 'medium' | 'high'>('medium');
</script>

<Modal bind:open title="Агент задачи">
  <div data-inventory class="agents">
    {#each [{ id: 'claude-code', name: 'Claude Code' }, { id: 'codex', name: 'Codex' }] as const as option (option.id)}
      <button
        data-inventory
        type="button"
        class="agent"
        class:on={agent === option.id}
        onclick={() => (agent = option.id)}
      >
        <AgentLogo agent={option.id} size={21} />
        <span data-inventory>{option.name}</span>
      </button>
    {/each}
  </div>
  <div data-inventory class="column-sm">
    <span data-inventory class="sk-label">Усилие</span>
    <div data-inventory>
      <Segmented
        bind:value={effort}
        options={[
          { value: 'low', label: 'Низкое' },
          { value: 'medium', label: 'Среднее' },
          { value: 'high', label: 'Высокое' },
        ]}
      />
    </div>
  </div>
  {#snippet footer()}
    <Button onclick={() => (open = false)}>Отмена</Button>
    <Button variant="primary" onclick={() => (open = false)}>Сохранить</Button>
  {/snippet}
</Modal>
