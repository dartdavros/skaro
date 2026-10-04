import { addMessages } from '@skaro/ui';

addMessages('ru', {
  'feed.mergeUndo.action': 'Отменить слияние',
  'feed.mergeUndo.tip': 'Отменить слияние · {commit}',
  'feed.mergeUndo.confirm': 'Изменения коммита {commit} будут отменены. Задача вернётся на ревью.',
});
addMessages('en', {
  'feed.mergeUndo.action': 'Revert merge',
  'feed.mergeUndo.tip': 'Revert merge · {commit}',
  'feed.mergeUndo.confirm':
    'Changes from commit {commit} will be reverted. The task will return to review.',
});
