import {
  SHUTDOWN_SLOW_SECONDS,
  shutdownSeconds,
  shutdownTime,
  type ShutdownState,
} from '../../../shared/shutdown';
import { bootstrap } from '../bootstrap';

export function createShutdownController() {
  let state = $state.raw<ShutdownState | undefined>(bootstrap?.shutdown);
  let now = $state(Date.now());
  const startedAt = $derived(state?.startedAt);
  const seconds = $derived(startedAt === undefined ? 0 : shutdownSeconds(startedAt, now));
  $effect(() => {
    let disposed = false;
    const update = (value: ShutdownState | undefined) => {
      if (!disposed && value && (!state || value.revision > state.revision)) state = value;
    };
    const off = window.skaro.on('app.shutdown', update);
    void Promise.resolve()
      .then(() => window.skaro.invoke('app.shutdownState'))
      .then(update)
      .catch(() => undefined);
    return () => {
      disposed = true;
      off();
    };
  });
  $effect(() => {
    if (startedAt === undefined) return;
    now = Date.now();
    const timer = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(timer);
  });
  $effect(() => {
    if (startedAt === undefined) return;
    const id = startedAt;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        void window.skaro.invoke('app.shutdownPainted', id).catch(() => undefined);
      });
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  });
  return {
    get state() {
      return state;
    },
    get time() {
      return shutdownTime(seconds);
    },
    get slow() {
      return seconds >= SHUTDOWN_SLOW_SECONDS;
    },
  };
}
