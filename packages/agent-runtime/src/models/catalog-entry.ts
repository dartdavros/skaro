import type { Model } from '@skaro/timeline';

/** Provider-advertised metadata; absent price/capability information stays unknown. */
export interface ModelCatalogEntry extends Model {
  name: string;
  supportedParameters: string[];
  pricing: { prompt: string | null; completion: string | null; request: string | null };
  reasoning?: {
    supportedEfforts?: string[] | null;
    defaultEffort?: string | null;
    defaultEnabled?: boolean | null;
    mandatory?: boolean | null;
    supportsMaxTokens?: boolean | null;
  };
}
