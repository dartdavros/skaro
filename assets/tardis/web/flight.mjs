import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createFlightAudio } from './audio.mjs';
import { createLamp } from './lamp.mjs';
import { FLIGHT_DURATION, sampleFlight } from './motion.mjs';
import { disposeModel } from './resources.mjs';
import { createScene } from './scene.mjs';

/** Load once, then call play() from the existing Easter-egg button. */
export async function createTardisFlight({
  canvas,
  modelUrl,
  modelData,
  duration = FLIGHT_DURATION,
  audio,
  occluderImage,
  occluderTextureUrl,
  avoidElement,
  anchorElement,
  onAudioError = (error) => console.error('TARDIS audio:', error),
  onComplete = () => {},
}) {
  sampleFlight(0, duration);
  if (!canvas) throw new TypeError('A canvas is required.');
  const loader = new GLTFLoader();
  const gltf = modelData
    ? await loader.parseAsync(modelData, '')
    : await loader.loadAsync(modelUrl);
  const model = gltf.scene;
  let lamp;
  let view;
  const oldOpacity = canvas.style.opacity;
  try {
    lamp = createLamp(model);
    view = createScene(canvas, model, {
      occluderImage,
      occluderTextureUrl,
      avoidElement,
      anchorElement,
    });
  } catch (error) {
    lamp?.dispose();
    disposeModel(model);
    throw error;
  }
  let frame = 0;
  let elapsed = 0;
  let previous = null;
  let playing = false;
  let disposed = false;
  const sound = audio ? createFlightAudio(audio, duration, onAudioError) : null;
  view.clear();

  function render(seconds) {
    if (disposed) throw new Error('This TARDIS flight has been disposed.');
    const state = sampleFlight(seconds, duration);
    lamp.update(state.lamp);
    view.render(state);
    return state;
  }
  function seek(seconds) {
    const state = render(seconds);
    elapsed = Math.max(0, Math.min(duration, seconds));
    previous = null;
    sound?.seek(elapsed);
    return state;
  }
  function tick(now) {
    if (!playing) return;
    if (!document.hidden && previous !== null) elapsed += (now - previous) / 1000;
    previous = document.hidden ? null : now;
    const state = render(elapsed);
    sound?.update(elapsed);
    if (state.done) {
      playing = false;
      sound?.stop();
      view.clear();
      onComplete();
      return;
    }
    frame = requestAnimationFrame(tick);
  }
  function pause() {
    playing = false;
    previous = null;
    cancelAnimationFrame(frame);
    sound?.pause();
  }
  function play() {
    if (disposed) throw new Error('This TARDIS flight has been disposed.');
    pause();
    elapsed = 0;
    seek(0);
    playing = true;
    sound?.start();
    frame = requestAnimationFrame(tick);
  }
  function visibilityChanged() {
    // Background tabs pause time rather than skipping the flight on return.
    previous = null;
    if (!playing) return;
    if (document.hidden) sound?.pause();
    else sound?.resume();
  }
  document.addEventListener('visibilitychange', visibilityChanged);
  return {
    play,
    pause,
    seek,
    stop() {
      pause();
      elapsed = 0;
      sound?.stop();
      view.clear();
    },
    dispose() {
      if (disposed) return;
      pause();
      disposed = true;
      sound?.dispose();
      document.removeEventListener('visibilitychange', visibilityChanged);
      lamp.dispose();
      view.dispose();
      disposeModel(model);
      canvas.style.opacity = oldOpacity;
    },
    get playing() {
      return playing;
    },
    get elapsed() {
      return elapsed;
    },
  };
}
