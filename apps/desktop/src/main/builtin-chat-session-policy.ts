import type { BuiltinSessionStart } from '@skaro/timeline';
import { requireBuiltinSessionPolicy } from './builtin-session-policy';

export function requireBuiltinChatSessionPolicy(
  expected: Parameters<typeof requireBuiltinSessionPolicy>[0],
  config: BuiltinSessionStart,
) {
  const { scope } = expected;
  if (
    scope.kind !== 'project_chat' ||
    !scope.chatId ||
    Object.keys(scope).some(
      (name) => !['kind', 'projectId', 'chatId', 'importId'].includes(name),
    ) ||
    config.tools?.verificationScope
  )
    throw new Error(
      'Builtin chat startup requires an exact chat/import scope without task authority',
    );
  requireBuiltinSessionPolicy(expected, config);
}
