import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, Euler, PerspectiveCamera, Vector3 } from 'three';
import {
  clearanceWorldY,
  flightClearance,
  flightModelFit,
  measureFlightBottom,
} from './clearance.mjs';
import { FLIGHT_DURATION, sampleFlight } from './motion.mjs';

test('the whole rotating body and lamp stay above the app at every flight phase', () => {
  const box = new Box3(new Vector3(-0.8, -1.52, -0.8), new Vector3(0.8, 1.62, 0.8));
  for (const [width, top, obstacleTop] of [
    [1019, 77, 510],
    [1265, 7, 478],
    [1905, -51, 531],
    [360, 100, 600],
  ]) {
    const canvas = { top, height: (width * 2) / 3 };
    const camera = new PerspectiveCamera(42, 1.5, 0.1, 80);
    camera.position.z = 10;
    camera.updateMatrixWorld();
    const fit = 1.5 / 1.45;
    const modelFit = flightModelFit(camera.aspect, canvas.height);
    const bottom = measureFlightBottom(box, camera, fit, modelFit);
    const shift = flightClearance(bottom, canvas, { top: obstacleTop });
    const scrolledShift = flightClearance(
      bottom,
      { ...canvas, top: top - 200 },
      { top: obstacleTop - 200 },
    );
    assert.ok(Math.abs(shift - scrolledShift) < 1e-12);
    for (let step = 0; step <= 1000; step++) {
      const state = sampleFlight((step / 1000) * FLIGHT_DURATION);
      const rotation = new Euler(...state.rotation, 'YXZ');
      const lift = clearanceWorldY(shift, state.position[2], camera);
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) {
            const point = new Vector3(x, y, z).multiplyScalar(modelFit).applyEuler(rotation);
            point.add(
              new Vector3(state.position[0] * fit, state.position[1] + lift, state.position[2]),
            );
            point.project(camera);
            const screenY = top + ((1 - point.y) / 2) * canvas.height;
            assert.ok(screenY < obstacleTop - 14);
            if (width === 1905 && state.progress >= 1 / 3 && state.progress <= 2 / 3)
              assert.ok(screenY > 0, 'the full-screen crest must remain below the viewport top');
          }
    }
  }
});
