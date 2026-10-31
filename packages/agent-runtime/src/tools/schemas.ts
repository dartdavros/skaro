import { z } from 'zod';

const path = z.string().min(1).max(4096);
const integer = (max: number) => z.number().int().min(0).max(max);
const evidenceReference = z.strictObject({
  sequence: z.number().int().min(1),
  hash: z.string().regex(/^[a-f0-9]{64}$/),
});
export const schemas = {
  diagnose_check: z.strictObject({
    evidence: evidenceReference,
    category: z.enum([
      'implementation',
      'command',
      'infrastructure',
      'flaky',
      'unrelated',
      'unknown',
    ]),
    reason: z.string().min(1).max(8192),
    correction: z.string().min(1).max(8192),
  }),
  run_check: z.strictObject({
    retryOf: evidenceReference.optional(),
    name: z.string().min(1).max(200),
    criteria: z.array(z.string().min(1).max(200)).min(1).max(100),
    command: z.string().min(1).max(100_000),
    cwd: path.optional(),
    shell: z.enum(['powershell', 'cmd', 'sh', 'bash']).optional(),
    timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000),
  }),
  check_evidence: z.strictObject({
    sequence: z.number().int().min(1),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  }),
  find_files: z.strictObject({
    path: path.optional(),
    pattern: z.string().max(512).optional(),
    offset: integer(100_000).default(0),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  search_text: z.strictObject({
    path: path.optional(),
    text: z.string().min(1).max(4096),
    caseSensitive: z.boolean().default(true),
    offset: integer(100_000).default(0),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  read_file: z.strictObject({
    path,
    startLine: z.number().int().min(1).default(1),
    maxLines: z.number().int().min(1).max(1000).default(200),
    column: integer(2_000_000).default(0),
  }),
  apply_patch: z.strictObject({
    path,
    expectedHash: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    operation: z.enum(['create', 'update', 'delete']),
    changes: z
      .array(z.strictObject({ before: z.string().min(1), after: z.string() }))
      .max(100)
      .default([]),
    content: z.string().max(2_000_000).optional(),
  }),
  exec_command: z.strictObject({
    command: z.string().min(1).max(100_000),
    cwd: path.optional(),
    shell: z.enum(['powershell', 'cmd', 'sh', 'bash']).optional(),
    timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000),
    yieldMs: integer(10_000).default(1000),
  }),
  write_stdin: z.strictObject({
    processId: z.string().min(1),
    chars: z.string().max(1_000_000).optional(),
    end: z.boolean().default(false),
    offset: integer(100_000_000).default(0),
    yieldMs: integer(10_000).default(1000),
  }),
  stop_process: z.strictObject({ processId: z.string().min(1) }),
  ask_user: z.strictObject({
    questions: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          header: z.string(),
          text: z.string().min(1),
          multi: z.boolean(),
          allowFreeText: z.boolean(),
          options: z.array(
            z.strictObject({ label: z.string().min(1), description: z.string().optional() }),
          ),
        }),
      )
      .min(1)
      .max(5),
  }),
  update_plan: z.strictObject({
    steps: z
      .array(
        z.strictObject({
          id: z.string().min(1),
          text: z.string().min(1),
          activeText: z.string().optional(),
          status: z.enum(['pending', 'active', 'done']),
        }),
      )
      .max(100),
  }),
  view_image: z.strictObject({ path }),
  context_read: z.strictObject({
    id: z.string().min(1),
    cursor: integer(2_000_000).default(0),
    limit: z.number().int().min(1).max(16_384).default(8192),
  }),
  context_history: z.strictObject({
    sequence: z.number().int().min(1),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    cursor: integer(100_000_000).default(0),
    limit: z.number().int().min(1).max(16_384).default(8192),
  }),
} as const;
export type ToolName = keyof typeof schemas;
export type ToolArgs<N extends ToolName> = z.output<(typeof schemas)[N]>;
export const isToolName = (name: string): name is ToolName => Object.hasOwn(schemas, name);
export const toolCatalog = () =>
  Object.entries(schemas).map(([name, schema]) => ({ name, inputSchema: z.toJSONSchema(schema) }));
export const writeTools = new Set<ToolName>([
  'apply_patch',
  'exec_command',
  'run_check',
  'write_stdin',
  'stop_process',
  'update_plan',
]);
