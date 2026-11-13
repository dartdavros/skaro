import type { C4Protocol } from '@skaro/core';
export interface C4CoordinationMethods {
  'c4.coordination': (project: string) => { protocol: C4Protocol };
  'c4.selectProtocol': (
    project: string,
    protocol: C4Protocol,
    expected: C4Protocol,
  ) => { protocol: C4Protocol };
}
