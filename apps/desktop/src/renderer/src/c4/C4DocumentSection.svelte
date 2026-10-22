<script lang="ts">
  import { t, addMessages } from '@skaro/ui';
  import type { C4Attachment } from '@skaro/core/c4-view';
  import C4Attachments from './C4Attachments.svelte';
  addMessages('ru', {
    'c4.document.explanation':
      'Текущая архитектура и планируемые изменения отмечены в каждом представлении.',
  });
  addMessages('en', {
    'c4.document.explanation':
      'Current architecture and planned changes are identified in each view.',
  });
  let { attachment }: { attachment: C4Attachment } = $props();
</script>

<div class="md">
  <h2>C4 · {attachment.model.revision}</h2>
  <p>{t('c4.document.explanation')}</p>
  <C4Attachments {attachment} />
  {#if attachment.model.exclusions.length || attachment.model.questions.length}
    <ul>
      {#each attachment.model.exclusions as item (`${item.scope}/${item.kind}/${item.state}`)}
        <li>{item.scope} / {item.kind} / {item.state}: {item.reason} ({item.evidence})</li>
      {/each}
      {#each attachment.model.questions as item (item.id)}
        <li>{item.id}: {item.question} ({item.affects.join(', ')})</li>
      {/each}
    </ul>
  {/if}
</div>
