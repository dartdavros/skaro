import { describe, expect, it } from 'vitest';
import {
  requireAnimationIndex,
  requireMotionStylesheet,
  workflowToolNames,
} from './verification/task-workflow-tools';

describe('reviewed animation index changes', () => {
  const plane = '<g id="plane"><g id="pilot"><path d="M1 2"/></g></g>';
  const clouds = '<g id="clouds-far"><circle r="4"/></g>';
  const page = (groups: string) =>
    `<html><head></head><body><svg viewBox="0 0 1600 900">${groups}</svg></body></html>`;

  it('allows complete group reordering and the two approved stylesheet links', () => {
    const changed = page('<!-- clouds -->' + clouds + plane).replace(
      '</head>',
      '<link rel="stylesheet" href="css/cat-motion.css"><link rel="stylesheet" href="css/plane-motion.css"></head>',
    );
    expect(() =>
      requireAnimationIndex(page(plane + '<!-- clouds -->' + clouds), changed),
    ).not.toThrow();
  });

  it('refuses changes to geometry, hierarchy, SVG attributes or outer layout', () => {
    const original = page(plane + clouds);
    for (const changed of [
      original.replace('M1 2', 'M2 3'),
      page('<g id="plane">' + clouds + '<g id="pilot"><path d="M1 2"/></g></g>'),
      original.replace('1600 900', '800 600'),
      original.replace('<body>', '<body class="new-layout">'),
      original.replace('</head>', '<link rel="stylesheet" href="evil.css"></head>'),
    ])
      expect(() => requireAnimationIndex(original, changed)).toThrow();
  });
});

describe('reviewed motion declarations', () => {
  it('allows animation transforms while rejecting layout, colors and external content', () => {
    expect(() =>
      requireMotionStylesheet(
        '#cat { animation: walk var(--cycle) infinite; transform-origin: center; } @keyframes walk { 0% { transform: translateX(0); opacity: 0; } }',
      ),
    ).not.toThrow();
    for (const css of [
      '#cat { fill: red; }',
      '#cat { margin: 0; }',
      '@import "remote.css";',
      '#cat { animation: url(https://example.test); }',
      '#cat { \\66ill: red; }',
    ])
      expect(() => requireMotionStylesheet(css)).toThrow();
  });
});

// Pure decision inputs; no journal, project, task, run or service is created.
describe('verification prerequisite selection', () => {
  const request = {
    id: 'tool-request:inspect',
    facts: [
      {
        type: 'tool-request' as const,
        id: 'inspect',
        hash: 'a'.repeat(64),
        name: 'inspect_acceptance',
      },
    ],
    result: {},
  };
  const receipt = {
    id: 'cmd:inspect',
    facts: [],
    result: { value: { binding: { execution: 'allowed' } } },
  };
  it('does not treat model assertions, missing or failed inspection as a host receipt', () => {
    const claim = {
      id: 'model-result',
      facts: [],
      result: { value: { message: { content: 'All checked' } } },
    };
    for (const records of [
      [claim],
      [request],
      [request, { ...receipt, result: { error: 'Inspection failed' } }],
    ])
      expect(workflowToolNames(records, true)).toEqual(['inspect_acceptance']);
  });
  it('requires a real plan before checks and exposes the permitted C4 tools in ordinary selection', () => {
    expect(workflowToolNames([request, receipt], true)).toEqual(['plan_checks']);
    expect(workflowToolNames([request, receipt])).toContain('mcp__skaro__get_c4_context');
    const plan = { id: 'check-plan', facts: [], result: { value: { kind: 'verification-plan' } } };
    expect(workflowToolNames([request, receipt, plan], true)).toEqual(['run_check']);
    const check = { id: 'check-result', facts: [], result: { value: { kind: 'command-check' } } };
    expect(workflowToolNames([request, receipt, plan, check], true)).toBeUndefined();
  });
});
