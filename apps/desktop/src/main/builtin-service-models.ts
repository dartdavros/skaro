import { BuiltinTaskModels, type BuiltinTaskAuthorization } from './builtin-task-models';
import { BuiltinChatModels, type BuiltinChatAuthorization } from './builtin-chat-models';
import type { BuiltinSessionModelDependencies } from './builtin-session-models';
import { productModelAuthorization } from './builtin-product-models';
import type { AppDb } from '@skaro/core';
import { BUILTIN_PRODUCT_RELEASED } from '@skaro/agents';

/** A scoped verification never inherits ordinary product admission. */
export function builtinServiceModels(
  deps: BuiltinSessionModelDependencies,
  scoped: boolean,
  options: { builtinTasks?: BuiltinTaskAuthorization; builtinChats?: BuiltinChatAuthorization },
  db: AppDb,
) {
  const product =
    scoped || !BUILTIN_PRODUCT_RELEASED ? undefined : productModelAuthorization(deps, db);
  const tasks = options.builtinTasks ?? product;
  const chats = options.builtinChats ?? product;
  return {
    ...(tasks ? { builtinSessions: new BuiltinTaskModels({ ...deps, authorize: tasks }) } : {}),
    ...(chats ? { builtinChatSessions: new BuiltinChatModels({ ...deps, authorize: chats }) } : {}),
  };
}
