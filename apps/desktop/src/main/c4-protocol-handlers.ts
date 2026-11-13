import type { AppDb } from '@skaro/core';
import type { Handlers } from './ipc';
import type { C4CoordinationMethods } from '../shared/c4-coordination';
import { projectC4Protocol, selectC4Protocol } from './c4-protocol';
import { requireCoordinationDispatch } from './coordination-dispatch';

/** Explicit owner selection affects new runs only; existing operations retain their protocol. */
export function c4ProtocolHandlers(db: AppDb): Pick<Handlers, keyof C4CoordinationMethods> {
  return {
    'c4.coordination': (project) => ({ protocol: projectC4Protocol(db, project) }),
    'c4.selectProtocol': (project, protocol, expected) => {
      requireCoordinationDispatch(db, project);
      return { protocol: selectC4Protocol(db, project, protocol, expected) };
    },
  };
}
