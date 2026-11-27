import { matchesC4BodyHash } from '@skaro/core';
import type { C4Model } from '@skaro/core/c4-view';
import type { Facts, SourceFile } from '../facts';
import { c4NodeId } from './c4-id';

export function projectC4Bindings(
  model: C4Model,
  files: SourceFile[],
  facts: Facts,
  diagnostic: (path: string, message: string) => void,
): void {
  const source = files.find((file) => file.path === '.skaro/c4/model.json')!;
  const ref = facts.ref(source);
  for (const spec of model.specifications) {
    const path = spec.path.startsWith('.skaro/') ? spec.path : `.skaro/${spec.path}`;
    const document = facts.nodes.get(`file:${path}`),
      file = files.find((file) => file.path === path);
    if (!document || !file) {
      diagnostic(source.path, `SPEC-${spec.id}: bound document is unavailable: ${path}`);
      continue;
    }
    try {
      document.attributes.c4Stale = !matchesC4BodyHash(file.text, spec.bodyHash);
    } catch (error) {
      diagnostic(path, String(error));
      document.attributes.c4Stale = true;
    }
    document.attributes.c4Views = spec.views;
    document.attributes.c4Relationships = spec.relationships;
    if (document.attributes.c4Stale)
      diagnostic(path, `SPEC-${spec.id}: accepted C4 binding is stale after document edits`);
    for (const element of spec.elements) {
      const target = model.elements.find((item) => item.id === element);
      if (target)
        facts.edge(
          document.id,
          c4NodeId(model, element, target.state),
          'documents',
          ref,
          'c4/specification',
          'Explicit accepted specification binding; freshness is shown on its document',
          'accepted-c4',
          'explicit',
        );
    }
    for (const requirement of spec.requirements) {
      const id = `requirement:SPEC-${spec.id}:${requirement.id}`;
      const node = facts.nodes.get(id);
      if (node) {
        node.attributes.c4Views = requirement.views;
        node.attributes.c4Relationships = requirement.relationships;
      }
      for (const element of requirement.elements) {
        const target = model.elements.find((item) => item.id === element);
        if (target && node)
          facts.edge(
            c4NodeId(model, element, target.state),
            id,
            'implements-requirement',
            ref,
            'c4/requirement',
            'Explicit accepted requirement binding; code symbols are not inferred',
            'accepted-c4',
            'explicit',
          );
      }
    }
    for (const relationship of spec.relationships) {
      for (const id of [`c4:${relationship}`, `c4:planned:${relationship}`]) {
        const edge = facts.edges.get(id);
        edge?.evidence.push({
          sourceRef: facts.ref(file),
          rule: 'c4/specification-binding',
          explanation: `Accepted binding SPEC-${spec.id}${document.attributes.c4Stale ? ' (stale)' : ''}`,
        });
      }
    }
  }
  for (const state of ['current', 'planned'] as const)
    for (const element of model.elements) {
      const id = c4NodeId(model, element.id, state);
      if (!facts.nodes.has(id)) continue;
      const decisions =
        state === 'planned' && element.planned ? element.planned.decisions : element.decisions;
      for (const decision of decisions) {
        const number = decision.replace(/^ADR-/, '').padStart(4, '0');
        const target = [...facts.nodes.values()].find(
          (node) => node.attributes.artifactId === `ADR-${number}`,
        );
        if (target) {
          const edge = facts.edge(
            id,
            target.id,
            'governed-by',
            ref,
            'c4/decision',
            'Explicit accepted architectural decision binding',
            'accepted-c4',
            'explicit',
          );
          facts.edges.get(edge)!.state = facts.nodes.get(id)!.state;
        }
      }
    }
}
