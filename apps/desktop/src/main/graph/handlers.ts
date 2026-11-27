import type { Handlers } from '../ipc';
import type { GraphMethods } from '../../shared/graph';
import type { GraphService } from './service';
export function graphHandlers(
  graph: GraphService,
): Pick<Handlers, keyof GraphMethods | 'graph.exportPage'> {
  return {
    'graph.open': (id, token) => graph.open(id, token),
    'graph.close': (token) => graph.deactivate(token),
    'graph.status': (id) => graph.status(id),
    'graph.rebuild': (id) => graph.rebuild(id),
    'graph.cancel': (id) => graph.cancel(id),
    'graph.query': (query) => graph.query(query),
    'graph.exportPage': (scope, kind, after) => graph.exportPage(scope, kind, after),
    'graph.scenarios': (scope) => graph.scenarios(scope),
    'graph.model': (scope) => graph.model(scope),
    'graph.source': (scope, ref) => graph.source(scope, ref),
    'graph.view': (id) => graph.view(id),
    'graph.saveView': (id, view) => graph.saveView(id, view),
  };
}
