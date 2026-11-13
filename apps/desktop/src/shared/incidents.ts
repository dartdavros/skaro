import type { CoordinationBlocker, RemedyPolicy } from '@skaro/core';
import type { InteractionAnswer } from '@skaro/timeline';
export interface IncidentMethods {
  'incidents.list': (projectId: string) => Promise<CoordinationBlocker[]>;
  'incidents.policy': (projectId: string) => Promise<RemedyPolicy>;
  'incidents.setPolicy': (
    projectId: string,
    policy: Omit<RemedyPolicy, 'revision'>,
    expected: number,
  ) => Promise<RemedyPolicy>;
  'incidents.recheck': (projectId: string, id: string) => Promise<void>;
  'incidents.answer': (projectId: string, id: string, answer: InteractionAnswer) => Promise<void>;
  'incidents.revoke': (projectId: string, id: string) => Promise<void>;
  'incidents.cancel': (projectId: string, id: string) => Promise<void>;
}
