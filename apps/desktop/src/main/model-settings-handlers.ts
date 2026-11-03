import { parseBuiltinConnectionDraft, parseBuiltinRoute } from '@skaro/agent-runtime';
import type { Handlers } from './ipc';
import type { ModelSettingsMethods } from '../shared/model-settings';
import type { Services } from './app-services';

export function modelSettingsHandlers(
  service: Services['modelSettings'],
  changed: () => void = () => {},
) {
  const mutate = async <T>(work: Promise<T>) => {
    const value = await work;
    changed();
    return value;
  };
  const revision = (value: number) => {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid settings revision');
  };
  const safe = async <T>(work: () => Promise<T>) => {
    try {
      return await work();
    } catch {
      throw new Error('MODEL_SETTINGS_REJECTED');
    }
  };
  return {
    'models.settings': () => safe(() => service.read()),
    'models.saveConnection': (expected, raw, secret?: string) =>
      safe(async () => {
        revision(expected);
        if (
          secret !== undefined &&
          (typeof secret !== 'string' ||
            !secret.length ||
            secret.length > 16_384 ||
            [...secret].some((char) => char.charCodeAt(0) < 33 || char.charCodeAt(0) > 126))
        )
          throw new Error('Invalid API key');
        return mutate(service.saveConnection(expected, parseBuiltinConnectionDraft(raw), secret));
      }),
    'models.saveRoute': (expected, raw) =>
      safe(async () => {
        revision(expected);
        return mutate(service.saveRoute(expected, parseBuiltinRoute(raw)));
      }),
    'models.remove': (expected, kind, id) =>
      safe(async () => {
        revision(expected);
        if (
          !['connection', 'route'].includes(kind) ||
          typeof id !== 'string' ||
          !/^[a-zA-Z0-9_-]{1,160}$/.test(id)
        )
          throw new Error('Invalid settings identity');
        return mutate(service.remove(expected, kind, id));
      }),
  } satisfies Pick<Handlers, keyof ModelSettingsMethods>;
}
