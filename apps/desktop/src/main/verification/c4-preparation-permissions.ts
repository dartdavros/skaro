import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';

/** Original live native approvals only; exact read commands, never session grants or policy amendments. */
export async function approveC4PreparationReads(s: Services, project: string, chat: string) {
  const view = await s.chats.open(project, chat);
  const requests = view.timeline.interactions.filter((i) => i.kind === 'approval');
  if (!requests.length) return;
  const record = s.db.getChat(chat)!;
  const lines = (await readFile(join(s.dataDir, record.logPath), 'utf8'))
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  for (const interaction of requests) {
    assert.equal(interaction.kind, 'approval');
    assert(interaction.action.type === 'command' && interaction.choices.includes('allow_once'));
    const request = lines.findLast(
      (entry) =>
        entry.line?.method === 'item/commandExecution/requestApproval' &&
        `req-${entry.line.id}` === interaction.id,
    )?.line.params;
    assert(
      request && resolve(request.cwd) === resolve(s.projects.get(project).root),
      'Approval must address the actual Cat-pilot checkout',
    );
    assert.equal(request.commandActions?.length, 1);
    const command = String(request.commandActions[0].command).trim();
    const listing = "rg --files --hidden -g '!.git/**' -g '!node_modules/**' -g '!vendor/**'";
    const content =
      /^Get-Content\s+(?:-Raw\s+)?-LiteralPath\s+['"]?(index\.html|css[\\/](?:base|cat|plane|scene)\.css|js[\\/]controls\.js|docs[\\/]storyboard\.md)['"]?(?:\s+-Raw)?$/i;
    assert(
      command === listing || content.test(command),
      `Unapproved preparation command: ${command}`,
    );
    await sessionHandlers(s)['chat.respond'](project, chat, interaction.id, {
      kind: 'approval',
      choice: 'allow_once',
    });
    process.send?.({ stage: 'read-only-command-approved-once', chatId: chat, command });
  }
}
