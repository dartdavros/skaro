import { Euler, Vector3 } from 'three';
import { FLIGHT_DURATION, sampleFlight } from './motion.mjs';

/** Keep the close-up within the header area when the scene grows on wide screens. */
export function flightModelFit(aspect, height) {
  return 0.7 * Math.min(1, aspect / 0.75, 1080 / height);
}

/** Measure the complete rotating model, rather than just its centre. */
export function measureFlightBottom(box, camera, horizontalFit, modelFit) {
  const corners = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) corners.push(new Vector3(x, y, z));
  const rotation = new Euler(0, 0, 0, 'YXZ');
  const point = new Vector3();
  let bottom = 0;
  for (let step = 0; step <= 360; step++) {
    const state = sampleFlight((step / 360) * FLIGHT_DURATION);
    rotation.set(...state.rotation, 'YXZ');
    for (const corner of corners) {
      point.copy(corner).multiplyScalar(modelFit).applyEuler(rotation);
      point.x += state.position[0] * horizontalFit;
      point.y += state.position[1];
      point.z += state.position[2];
      point.project(camera);
      bottom = Math.max(bottom, (1 - point.y) / 2);
    }
  }
  return bottom;
}

/** Shift the entire projected ellipse up; never crop the model at the window. */
export function flightClearance(bottom, canvas, obstacle, gap = 16) {
  return Math.max(0, (canvas.top + bottom * canvas.height - obstacle.top + gap) / canvas.height);
}

export function clearanceWorldY(shift, depth, camera) {
  return shift * 2 * (camera.position.z - depth) * Math.tan((camera.fov * Math.PI) / 360);
}
