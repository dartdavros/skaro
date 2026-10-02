// Texts of the task screen, agent feed, cards and composer (ru/en).
import { addMessages } from '@skaro/ui';
import * as timeline from './messages/timeline';
import * as cards from './messages/cards';
import * as task from './messages/task';
import * as agent from './messages/agent';
import * as diff from './messages/diff';

addMessages('ru', {
  ...timeline.ru,
  ...cards.ru,
  ...task.ru,
  ...agent.ru,
  ...diff.ru,
});

addMessages('en', {
  ...timeline.en,
  ...cards.en,
  ...task.en,
  ...agent.en,
  ...diff.en,
});
