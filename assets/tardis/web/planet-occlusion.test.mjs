import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3, PerspectiveCamera } from 'three';
import { planetBounds } from './planet-occlusion.mjs';
import { FLIGHT_DURATION, sampleFlight } from './motion.mjs';

test('planet mask follows transformed bounds, raised canvas and native scroll', () => {
  const canvas = { left: 0, top: 46, width: 1200, height: 800 };
  const planet = { left: -120, top: 155, width: 1440, height: 960 };
  const bounds = planetBounds(planet, canvas);
  assert.deepEqual(bounds, [-0.1, -269 / 800, 1.2, 1.2]);
  assert.deepEqual(
    planetBounds({ ...planet, top: planet.top - 300 }, { ...canvas, top: canvas.top - 300 }),
    bounds,
  );
});

test('departure and return are behind the solid disk; the close half passes in front', () => {
  assert.equal(sampleFlight(0).behindPlanet, true);
  assert.equal(sampleFlight(FLIGHT_DURATION).behindPlanet, true);
  for (const progress of [0.26, 0.5, 0.74]) {
    assert.equal(sampleFlight(progress * FLIGHT_DURATION).behindPlanet, false);
  }
  // Real image's solid disk: centre ~(.5,.497), radius ~.27w/.395h.
  // Match the site's 3:2 scene and its existing 15% upward canvas offset.
  for (const width of [360, 1200, 1920]) {
    const height = (width * 2) / 3;
    const camera = new PerspectiveCamera(42, 1.5, 0.1, 80);
    camera.position.set(0, 0, 10);
    camera.updateMatrixWorld();
    const close = new Vector3(...sampleFlight(FLIGHT_DURATION / 2).position).project(camera);
    // A shallow near arc avoids the oversized crest on a full-screen canvas.
    assert.ok((1 - close.y) / 2 > 0.5 && (1 - close.y) / 2 < 0.55);
    for (const progress of [0, 1]) {
      const state = sampleFlight(progress * FLIGHT_DURATION);
      // Check the entire rotated model's conservative bounding sphere.
      const centre = new Vector3(...state.position);
      centre.x *= 1.5 / 1.45;
      for (const offset of [
        [-1.2, 0, 0],
        [1.2, 0, 0],
        [0, -1.2, 0],
        [0, 1.2, 0],
      ]) {
        const point = centre
          .clone()
          .add(new Vector3(...offset))
          .project(camera);
        const x = (point.x + 1) / 2;
        const y = (1 - point.y) / 2 - 0.15 - 50 / height;
        assert.ok(((x - 0.5) / 0.27) ** 2 + ((y - 0.497) / 0.395) ** 2 < 1);
      }
    }
  }
});
