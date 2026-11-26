export interface WorkflowPublication {
  pullRequest: number;
  head: string;
  workflow: string;
}

export const workflowPublicationSchema = {
  type: 'object',
  properties: {
    pullRequest: { type: 'integer', minimum: 1 },
    head: { type: 'string', pattern: '^[a-f0-9]{40}$' },
    workflow: { type: 'string', pattern: '^\\.github/workflows/[a-zA-Z0-9_.-]+\\.ya?ml$' },
  },
  required: ['pullRequest', 'head', 'workflow'],
  additionalProperties: false,
};

export function publicationRequest(value: unknown): WorkflowPublication {
  const request = value as Partial<WorkflowPublication> | undefined;
  if (
    !request ||
    !Number.isSafeInteger(request.pullRequest) ||
    request.pullRequest! < 1 ||
    typeof request.head !== 'string' ||
    !/^[a-f0-9]{40}$/.test(request.head) ||
    typeof request.workflow !== 'string' ||
    !/^\.github\/workflows\/[a-zA-Z0-9_.-]+\.ya?ml$/.test(request.workflow)
  )
    throw new Error(
      'Specify publication with a positive pullRequest, full head SHA and .github/workflows/<file>.yml path.',
    );
  return { pullRequest: request.pullRequest!, head: request.head, workflow: request.workflow };
}
