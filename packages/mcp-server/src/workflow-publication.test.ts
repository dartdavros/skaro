import { expect, it } from 'vitest';
import { publicationRequest } from './workflow-publication.ts';

it('requires an immutable commit and a workflow inside the repository workflow directory', () => {
  const request = {
    pullRequest: 1,
    head: 'be8b4c817bd92f0d5caf8199644e8b5a72ef7939',
    workflow: '.github/workflows/deploy.yml',
  };
  expect(publicationRequest(request)).toEqual(request);
  for (const head of ['main', request.head.slice(0, 7)]) {
    expect(() => publicationRequest({ ...request, head })).toThrow();
  }
  for (const workflow of [
    '.github/workflows/../config.yml',
    '.github/workflows/deploy.yml?ref=dev',
  ]) {
    expect(() => publicationRequest({ ...request, workflow })).toThrow();
  }
  expect(() => publicationRequest({ ...request, pullRequest: 0 })).toThrow();
});
