import { validateModelEndpoint, type RouteSnapshot } from '@skaro/timeline';

export function validateRoute(route: RouteSnapshot): void {
  if (
    route.schema !== 1 ||
    !route.routeId ||
    !route.modelId ||
    !route.connectionId ||
    !route.connector ||
    !route.apiProfile?.id ||
    !Number.isSafeInteger(route.routeRevision) ||
    route.routeRevision < 1 ||
    !Number.isSafeInteger(route.connectionRevision) ||
    route.connectionRevision < 1 ||
    !Number.isSafeInteger(route.apiProfile.revision) ||
    route.apiProfile.revision < 1
  )
    throw new Error('Invalid route snapshot');
  validateModelEndpoint(route.endpoint);
}
