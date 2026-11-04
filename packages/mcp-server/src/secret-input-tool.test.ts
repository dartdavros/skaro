import { expect, it } from 'vitest';
import { readSecretQuestions } from './secret-input-tool.ts';

it('accepts the metadata of multiple protected fields without option questions or values', () => {
  const questions = [
    { id: 'api_key', header: 'API-ключ', question: 'Введите API-ключ для живой проверки.' },
    { id: 'folder_id', header: 'Каталог', question: 'Введите ID каталога интеграции.' },
  ];
  expect(readSecretQuestions(questions)).toEqual(questions);
  expect(readSecretQuestions([{ ...questions[0], secret: false }])).toBeTypeOf('string');
  expect(readSecretQuestions([{ ...questions[0], value: 'not-an-input-property' }])).toBeTypeOf(
    'string',
  );
});

it('refuses incomplete, duplicate and oversized field requests before opening a card', () => {
  const field = { id: 'api_key', header: 'Ключ', question: 'Введите ключ.' };
  for (const input of [
    undefined,
    [],
    [null],
    [field, field],
    Array(4).fill(field),
    [{ ...field, id: '../key' }],
    [{ ...field, header: ' ' }],
    [{ ...field, header: 'x'.repeat(13) }],
    [{ ...field, question: ' ' }],
    [{ ...field, question: 'x'.repeat(1001) }],
  ])
    expect(readSecretQuestions(input)).toBeTypeOf('string');
});
