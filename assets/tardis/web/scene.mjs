import {
  ACESFilmicToneMapping,
  Box3,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { createPlanetOcclusion } from './planet-occlusion.mjs';
import {
  clearanceWorldY,
  flightClearance,
  flightModelFit,
  measureFlightBottom,
} from './clearance.mjs';
import { alignOverlay } from './overlay.mjs';
import { fitPlanetFlight } from './planet-anchor.mjs';

export function createScene(
  canvas,
  model,
  { occluderImage, occluderTextureUrl, avoidElement, anchorElement },
) {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;
  const scene = new Scene();
  scene.add(model, new HemisphereLight(0xe2efff, 0x26313f, 2.5));
  const key = new DirectionalLight(0xe7f1ff, 3.2);
  key.position.set(4, 6, 8);
  const rim = new DirectionalLight(0xc1d7ff, 2);
  rim.position.set(-3, 3, -4);
  scene.add(key, rim);
  const camera = new PerspectiveCamera(42, 1, 0.1, 80);
  camera.position.set(0, 0, 10);
  camera.updateMatrixWorld();
  const modelBounds = new Box3().setFromObject(model);
  let horizontalFit = 1;
  let modelFit = 0.7;
  let flightBottom = 0;

  function resize() {
    if (anchorElement) alignOverlay(canvas, anchorElement);
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    horizontalFit = Math.min(1.4, camera.aspect / 1.45);
    modelFit = flightModelFit(camera.aspect, height);
    if (avoidElement)
      flightBottom = measureFlightBottom(modelBounds, camera, horizontalFit, modelFit);
  }
  const observer = new ResizeObserver(resize);
  observer.observe(anchorElement ?? canvas);
  resize();
  const occlusion = occluderImage
    ? createPlanetOcclusion(occluderImage, canvas, occluderTextureUrl)
    : null;
  return {
    render(state) {
      if (anchorElement) alignOverlay(canvas, anchorElement);
      model.position.fromArray(state.position);
      model.position.x *= horizontalFit;
      let pose;
      if (avoidElement) {
        const canvasRect = canvas.getBoundingClientRect();
        const obstacle = avoidElement.getBoundingClientRect();
        const shift = flightClearance(flightBottom, canvasRect, obstacle);
        model.position.y += clearanceWorldY(shift, model.position.z, camera);
        if (occluderImage)
          pose = fitPlanetFlight(state, modelBounds, camera, {
            canvas: canvasRect,
            planet: occluderImage.getBoundingClientRect(),
            obstacle,
            modelFit,
            horizontalFit,
            shift,
          });
      }
      if (pose) model.position.fromArray(pose.position);
      model.rotation.set(...state.rotation, 'YXZ');
      model.scale.setScalar(pose?.scale ?? modelFit);
      // Fade the composed image so opaque panels never show through each other.
      canvas.style.opacity = String(state.opacity);
      renderer.render(scene, camera);
      occlusion?.render(renderer, state.behindPlanet);
    },
    clear() {
      canvas.style.opacity = '0';
      renderer.clear();
    },
    dispose() {
      observer.disconnect();
      occlusion?.dispose();
      renderer.dispose();
    },
  };
}
