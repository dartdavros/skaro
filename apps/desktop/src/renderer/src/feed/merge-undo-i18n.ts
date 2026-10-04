import { addMessages } from '@skaro/ui';

addMessages('ru', {
  'feed.mergeUndo.action': 'Отменить слияние',
  'feed.mergeUndo.tip': 'Отменить слияние · {commit}',
  'feed.mergeUndo.confirm': 'Изменения коммита {commit} будут отменены. Задача вернётся на ревью.',
  'feed.mergeUndo.stage.one': 'Отменить слияние этапа? {n} задача вернётся в «На ревью».',
  'feed.mergeUndo.stage.few': 'Отменить слияние этапа? {n} задачи вернутся в «На ревью».',
  'feed.mergeUndo.stage.many': 'Отменить слияние этапа? {n} задач вернутся в «На ревью».',
  'feed.mergeUndo.stage.other': 'Отменить слияние этапа? {n} задачи вернутся в «На ревью».',
  'feed.notice.merged.partial.one': 'Влито в {branch}: {n} задача',
  'feed.notice.merged.partial.few': 'Влито в {branch}: {n} задачи',
  'feed.notice.merged.partial.many': 'Влито в {branch}: {n} задач',
  'feed.notice.merged.partial.other': 'Влито в {branch}: {n} задачи',
  'feed.notice.stageDone': 'Сделано · войдёт в слияние этапа {stage}',
  'feed.notice.openStage': 'Открыть этап',
  'feed.notice.stageMerged': 'Влито в {branch} в составе этапа {stage}',
});
addMessages('en', {
  'feed.mergeUndo.action': 'Revert merge',
  'feed.mergeUndo.tip': 'Revert merge · {commit}',
  'feed.mergeUndo.confirm':
    'Changes from commit {commit} will be reverted. The task will return to review.',
  'feed.mergeUndo.stage.one': 'Revert the merge of the milestone? {n} task returns to review.',
  'feed.mergeUndo.stage.other': 'Revert the merge of the milestone? {n} tasks return to review.',
  'feed.notice.merged.partial.one': 'Merged into {branch}: {n} task',
  'feed.notice.merged.partial.other': 'Merged into {branch}: {n} tasks',
  'feed.notice.stageDone': 'Done · goes into the merge of milestone {stage}',
  'feed.notice.openStage': 'Open the milestone',
  'feed.notice.stageMerged': 'Merged into {branch} with milestone {stage}',
});
