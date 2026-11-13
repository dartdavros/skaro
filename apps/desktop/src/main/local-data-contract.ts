import type { ComposeModel } from './task-compose-ports';
import type { DockerContainer } from '@skaro/core';
import { labelsOf } from '@skaro/core';

export function persistentComposeData(model: ComposeModel) {
  return Object.entries(model.services).flatMap(([service, value]) => {
    const mounts = (value.volumes ?? []) as {
      type: string;
      source?: string;
      target: string;
      read_only?: boolean;
    }[];
    return mounts
      .filter((m) => m.type === 'volume' || (m.type === 'bind' && !m.read_only))
      .map((m) => ({ service, ...m }));
  });
}
export function localServiceImages(containers: DockerContainer[]): Record<string, string> {
  const images: Record<string, string> = {};
  for (const container of containers) {
    const service = labelsOf(container)['com.docker.compose.service'];
    if (!service || !container.Image || (images[service] && images[service] !== container.Image))
      throw new Error('Local service has no unambiguous image identity');
    images[service] = container.Image;
  }
  if (!Object.keys(images).length) throw new Error('Local candidate has no observed services');
  return Object.fromEntries(Object.entries(images).sort(([a], [b]) => a.localeCompare(b)));
}
