import type { OpenRouterCatalogEntry } from '@skaro/agent-runtime';

export interface ModelCatalogSnapshot {
  connectionId: string;
  connectionRevision: number;
  fetchedAt: number;
  evidence: 'catalog';
  models: OpenRouterCatalogEntry[];
}
export interface ModelCatalogMethods {
  'models.catalog': (
    connectionId: string,
    connectionRevision: number,
    refresh?: boolean,
  ) => ModelCatalogSnapshot;
}
