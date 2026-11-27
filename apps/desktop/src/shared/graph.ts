import type { C4Model } from '@skaro/core/c4-view';
import type {
  GraphStatus,
  GraphQuery,
  GraphScope,
  GraphPage,
  GraphScenario,
  GraphViewState,
  SourceRef,
} from '@skaro/core/graph-view';

export interface GraphMethods {
  'graph.open': (projectId: string, token: string) => GraphStatus;
  'graph.close': (token: string) => void;
  'graph.status': (projectId: string) => GraphStatus;
  'graph.rebuild': (projectId: string) => GraphStatus;
  'graph.cancel': (projectId: string) => GraphStatus;
  'graph.query': (query: GraphQuery) => GraphPage;
  'graph.scenarios': (scope: GraphScope) => GraphScenario[];
  'graph.model': (scope: GraphScope) => C4Model | null;
  'graph.source': (
    scope: GraphScope,
    ref: SourceRef,
  ) => { path: string; text: string; line: number };
  'graph.view': (projectId: string) => GraphViewState | null;
  'graph.saveView': (projectId: string, state: GraphViewState) => void;
}
export interface GraphEvents {
  'graph.changed': GraphStatus & { token: string };
}
