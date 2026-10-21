import { Euler, Vector3 } from 'three';
import { clearanceWorldY } from './clearance.mjs';
import { sampleFlight } from './motion.mjs';

export function projectedCorners(box, pose, camera, canvas) {
  const rotation = new Euler(...pose.rotation, 'YXZ');
  const points = [];
  for (const x of [box.min.x, box.max.x])
    for (const y of [box.min.y, box.max.y])
      for (const z of [box.min.z, box.max.z]) {
        const point = new Vector3(x, y, z).multiplyScalar(pose.scale).applyEuler(rotation);
        point.add(new Vector3(...pose.position)).project(camera);
        points.push({
          x: canvas.left + ((point.x + 1) / 2) * canvas.width,
          y: canvas.top + ((1 - point.y) / 2) * canvas.height,
        });
      }
  return points;
}

function verticalBounds(box, pose, camera, canvas) {
  const ys = projectedCorners(box, pose, camera, canvas).map((point) => point.y);
  return { top: Math.min(...ys), bottom: Math.max(...ys) };
}

/** Anchor the far end to the visible planet cap, after all viewport corrections. */
export function fitPlanetFlight(state, box, camera, layout) {
  const { canvas, planet, obstacle, modelFit, horizontalFit, shift } = layout;
  function basePose(sample, scale) {
    const [x, y, z] = sample.position;
    return {
      position: [x * horizontalFit, y + clearanceWorldY(shift, z, camera), z],
      rotation: sample.rotation,
      scale,
    };
  }
  // The real PNG's disk begins at .102h; its centre is .497h.
  const capTop = planet.top + planet.height * 0.102 + 8;
  const capBottom = Math.min(planet.top + planet.height * 0.497, obstacle.top - 16);
  const capHeight = Math.max(1, capBottom - capTop);
  const start = sampleFlight(0);
  const original = verticalBounds(box, basePose(start, modelFit), camera, canvas);
  const rearScale = modelFit * Math.min(1, (capHeight * 0.75) / (original.bottom - original.top));
  const rear = verticalBounds(box, basePose(start, rearScale), camera, canvas);
  const offset = (capTop + capBottom - rear.top - rear.bottom) / 2;
  const weight = (1 + Math.cos(state.progress * Math.PI * 2)) / 2;
  const pose = basePose(state, modelFit + (rearScale - modelFit) * weight);
  pose.position[1] -= clearanceWorldY((offset * weight) / canvas.height, pose.position[2], camera);
  const bounds = verticalBounds(box, pose, camera, canvas);
  const overlap = Math.max(0, bounds.bottom - obstacle.top + 16);
  pose.position[1] += clearanceWorldY(overlap / canvas.height, pose.position[2], camera);
  return pose;
}
