import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { skaroC4 } from '../../../../docs/c4/skaro-model.ts';
import { skaroC4Specification } from '../../../../docs/c4/skaro-specification.ts';
import { readC4Model } from './shape.ts';
import { validateC4Model } from './validate.ts';
import { c4BodyHash, c4Hash, validateC4Documents } from './documents.ts';
import { projectC4Document, authoredBody } from './render.ts';
import { c4AtState, realizeC4 } from './state.ts';
import { validateC4Code } from './project.ts';

// These assertions inspect the repository's real architectural documentation, not a fake app.
it('validates every documented Skaro view and its actual code paths', async () => {
  expect(validateC4Model(readC4Model(skaroC4))).toEqual([]);
  expect(
    await validateC4Code(fileURLToPath(new URL('../../../../', import.meta.url)), skaroC4),
  ).toEqual([]);
});

it('rejects ambiguous identities, cyclic hierarchy and invisible relationship endpoints', () => {
  const model = structuredClone(skaroC4);
  model.elements.push(structuredClone(model.elements[0]!));
  model.elements.find((e) => e.id === 'main')!.parent = 'main';
  model.views.find((v) => v.id === 'containers')!.elements = ['main'];
  const errors = validateC4Model(model).join('\n');
  expect(errors).toContain('duplicate identifier owner');
  expect(errors).toContain('cyclic hierarchy');
  expect(errors).toContain('no distinct visible endpoints');
});

it('refuses agent-specific styling and non-existent dynamic steps', () => {
  expect(() => readC4Model({ ...skaroC4, colors: ['red'] })).toThrow('unknown field colors');
  const model = structuredClone(skaroC4);
  model.views.find((v) => v.kind === 'dynamic')!.steps[0]!.relationship = 'unknown';
  expect(validateC4Model(model).join('\n')).toContain(
    'step references absent relationship unknown',
  );
});

it('requires explicit instance topology before projecting a replicated deployment', () => {
  const model = structuredClone(skaroC4);
  const view = model.views.find((v) => v.id === 'deployment')!;
  view.instances.push({
    ...view.instances.find((i) => i.element === 'renderer')!,
    id: 'renderersecondary',
  });
  expect(validateC4Model(model).join('\n')).toContain('ipc requires explicit instance topology');
  view.instanceRelationships = [
    { relationship: 'ipc', source: 'rendererinstance', target: 'maininstance' },
    { relationship: 'ipc', source: 'renderersecondary', target: 'maininstance' },
  ];
  expect(validateC4Model(model)).toEqual([]);
  view.instanceRelationships[0]!.target = 'dbinstance';
  expect(validateC4Model(model).join('\n')).toContain('invalid or duplicate instance relationship');
});

it('projects native C4 attachments without changing authored text', () => {
  const body = '## Architecture\n\nSkaro project documentation.\n';
  const document = projectC4Document(body, skaroC4, ['containers', 'deployment'], 'ru');
  expect(document).toContain('```skaro-c4\n');
  expect(document).not.toContain('```mermaid');
  expect(authoredBody(document)).toBe(body.trimEnd());
  expect(projectC4Document(document, skaroC4, ['containers', 'deployment'], 'ru')).toBe(document);
});

it('covers every real C4 requirement and detects stale specification edits', async () => {
  const text = await readFile(
    new URL('../../../../docs/c4/specification.md', import.meta.url),
    'utf8',
  );
  const model = structuredClone(skaroC4);
  model.specifications = [skaroC4Specification(text)];
  const documents = new Map([
    ['specs/0001-c4.md', `---\nid: "0001"\ntitle: C4\nstatus: accepted\n---\n${text}`],
  ]);
  expect(validateC4Documents(model, documents)).toEqual([]);
  const document = documents.get('specs/0001-c4.md')!;
  const crlf = (value: string) => value.replace(/\r?\n/g, '\r\n');
  documents.set('specs/0001-c4.md', crlf(document));
  expect(c4BodyHash(document)).toBe(c4BodyHash(crlf(document)));
  expect(validateC4Documents(model, documents)).toEqual([]);
  model.specifications[0]!.bodyHash = c4Hash(authoredBody(crlf(text)));
  documents.set('specs/0001-c4.md', document);
  expect(validateC4Documents(model, documents)).toEqual([]);
  model.specifications[0]!.requirements.pop();
  expect(validateC4Documents(model, documents).join('\n')).toContain('unmapped requirement R-9');
  documents.set(
    'specs/0001-c4.md',
    documents.get('specs/0001-c4.md')! + '\nChanged authored requirement.',
  );
  expect(validateC4Documents(model, documents).join('\n')).toContain('binding is stale');
});

it('keeps the current description until its specific planned change is realized', () => {
  const model = structuredClone(skaroC4);
  const service = model.elements.find((e) => e.id === 'c4service')!;
  service.planned = {
    name: service.name,
    description: 'Planned service responsibility',
    technology: service.technology,
    parent: service.parent,
    code: service.code,
    evidence: service.evidence,
    decisions: [],
  };
  expect(validateC4Model(model)).toEqual([]);
  expect(c4AtState(model, 'current').elements.find((e) => e.id === service.id)!.description).toBe(
    service.description,
  );
  expect(c4AtState(model, 'planned').elements.find((e) => e.id === service.id)!.description).toBe(
    'Planned service responsibility',
  );
  const published = realizeC4(model, [service.id]);
  expect(published.elements.find((e) => e.id === service.id)!.description).toBe(
    'Planned service responsibility',
  );
  expect(published.elements.find((e) => e.id === service.id)!.planned).toBeUndefined();
  expect(model.elements.find((e) => e.id === service.id)!.planned).toBeDefined();
});
