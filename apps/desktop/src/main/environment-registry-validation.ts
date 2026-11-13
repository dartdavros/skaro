import type { EnvironmentRecord, RetiredEnvironment } from './task-environment-registry';

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string =>
  typeof value === 'string' && !!value.trim() && !/[\0\r\n]/.test(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);
const texts = (value: unknown) => Array.isArray(value) && value.every(text);

export class EnvironmentRegistryUnavailable extends Error {
  constructor() {
    super('Environment registry is malformed; resources are retained.');
  }
}

export function retiredEnvironment(value: unknown): value is RetiredEnvironment {
  if (!object(value) || ![value.projectId, value.taskId, value.name].every(text)) return false;
  if (
    value.allocatedAt !== undefined &&
    (!Number.isSafeInteger(value.allocatedAt) || Number(value.allocatedAt) <= 0)
  )
    return false;
  if (value.worktree !== undefined && !text(value.worktree)) return false;
  if (
    value.source !== undefined &&
    (!object(value.source) || !text(value.source.project) || !texts(value.source.services))
  )
    return false;
  return true;
}

export function activeEnvironment(value: unknown): value is EnvironmentRecord {
  if (!retiredEnvironment(value) || !object(value)) return false;
  if (
    !object(value.ports) ||
    !Object.values(value.ports).every(
      (port) => Number.isInteger(port) && Number(port) > 0 && Number(port) <= 65535,
    )
  )
    return false;
  if (typeof value.created !== 'boolean' || !finite(value.usedAt)) return false;
  if (value.start !== undefined && !text(value.start)) return false;
  if (value.extraPorts !== undefined && !texts(value.extraPorts)) return false;
  if (
    value.previousPorts !== undefined &&
    (!object(value.previousPorts) ||
      !Object.values(value.previousPorts).every(
        (ports) => Array.isArray(ports) && ports.every(finite),
      ))
  )
    return false;
  return true;
}
