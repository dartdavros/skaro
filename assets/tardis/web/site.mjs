import { createTardisFlight } from './flight.mjs';
import modelData from '../tardis-2005.glb';
import audioUrl from '../audio/tardis-noise.mp3';
import planetTextureUrl from './planet-glow.png';

const button = document.querySelector('.bad-wolf');
const scene = document.querySelector('.hero__scene');
const planet = scene?.querySelector('[data-depth="planet"]');

if (button && scene) {
  const canvas = document.createElement('canvas');
  canvas.className = 'tardis-flight';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const audio = new Audio(audioUrl);
  audio.preload = 'auto';
  let flight;
  let initialization;
  let disposed = false;
  let request = 0;

  function initialize() {
    initialization ??= createTardisFlight({
      canvas,
      modelData: modelData.buffer,
      audio,
      occluderImage: planet,
      occluderTextureUrl: planetTextureUrl,
      avoidElement: document.querySelector('.skaro-window'),
      anchorElement: scene,
    })
      .then((created) => {
        if (disposed) {
          created.dispose();
          return null;
        }
        flight = created;
        return flight;
      })
      .catch((error) => {
        initialization = null;
        console.error('TARDIS Easter egg:', error);
        return null;
      });
    return initialization;
  }

  async function launch() {
    if (disposed) return;
    const currentRequest = ++request;
    if (flight) {
      flight.play();
      return;
    }
    // Unlock playback within the click when the first GLB parse is still pending.
    audio.muted = true;
    audio.play().catch((error) => {
      if (error.name !== 'AbortError') console.error('TARDIS audio:', error);
    });
    const ready = await initialize();
    if (disposed || currentRequest !== request) return;
    audio.pause();
    audio.currentTime = 0;
    audio.muted = false;
    ready?.play();
  }

  function leave(event) {
    request++;
    audio.pause();
    flight?.stop();
    if (event.persisted) return;
    disposed = true;
    button.removeEventListener('click', launch);
    window.removeEventListener('pagehide', leave);
    flight?.dispose();
    canvas.remove();
  }

  button.addEventListener('click', launch);
  window.addEventListener('pagehide', leave);
  // Prepare only the real model. No animation or audio starts before a click.
  initialize();
}
