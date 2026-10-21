import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { flightClearance, flightModelFit, measureFlightBottom } from './clearance.mjs';
import { FLIGHT_DURATION, sampleFlight } from './motion.mjs';
import { fitPlanetFlight, projectedCorners } from './planet-anchor.mjs';

test('corrected endpoints are fully inside the planet; the entire flight clears the window', () => {
  const box = new Box3(new Vector3(-0.8, -1.52, -0.8), new Vector3(0.8, 1.62, 0.8));
  for (const [width, top, windowTop] of [
    [1905, -51, 531],
    [1019, 77, 510],
    [360, 100, 600],
  ]) {
    const height = (width * 2) / 3;
    const canvas = { left: 0, top, width, height };
    const planet = { left: 0, top: top + height * 0.15 + 50, width, height };
    const obstacle = { top: windowTop };
    const camera = new PerspectiveCamera(42, 1.5, 0.1, 80);
    camera.position.z = 10;
    camera.updateMatrixWorld();
    const modelFit = flightModelFit(camera.aspect, height);
    const horizontalFit = camera.aspect / 1.45;
    const shift = flightClearance(
      measureFlightBottom(box, camera, horizontalFit, modelFit),
      canvas,
      obstacle,
    );
    const layout = { canvas, planet, obstacle, modelFit, horizontalFit, shift };
    for (let step = 0; step <= 1000; step++) {
      const state = sampleFlight((step / 1000) * FLIGHT_DURATION);
      const pose = fitPlanetFlight(state, box, camera, layout);
      for (const point of projectedCorners(box, pose, camera, canvas)) {
        assert.ok(point.y < windowTop - 14, 'no part may cross the app window');
        if (step === 0 || step === 1000) {
          const x = (point.x - planet.left - planet.width * 0.5) / (planet.width * 0.27);
          const y = (point.y - planet.top - planet.height * 0.497) / (planet.height * 0.395);
          assert.ok(x * x + y * y < 0.95, 'the whole endpoint must be behind the solid disk');
        }
        if (width === 1905 && state.progress >= 1 / 3 && state.progress <= 2 / 3)
          assert.ok(point.y > 0, 'the close arc must stay on screen');
      }
    }
  }
});
