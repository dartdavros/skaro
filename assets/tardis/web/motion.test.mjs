import assert from 'node:assert/strict';
import test from 'node:test';
import { FLIGHT_DURATION, sampleFlight } from './motion.mjs';

test('one spatial ellipse closes, moves in depth and has four axial rotations', () => {
  const start = sampleFlight(0);
  const end = sampleFlight(FLIGHT_DURATION);
  start.position.forEach((coordinate, axis) => {
    assert.ok(Math.abs(coordinate - end.position[axis]) < 1e-10);
  });
  for (let step = 0; step <= 100; step++) {
    const {
      position: [x, y, z],
    } = sampleFlight((step * FLIGHT_DURATION) / 100);
    assert.ok(Math.abs((x / 4.5) ** 2 + ((z + 1.3) / 3.7) ** 2 - 1) < 1e-10);
    assert.ok(Math.abs((y + 0.8) / 0.55 - (z + 1.3) / 3.7) < 1e-10);
  }
  assert.ok(sampleFlight(FLIGHT_DURATION / 2).position[2] - start.position[2] > 7);
  assert.ok(Math.abs(end.rotation[1] - start.rotation[1] - 8 * Math.PI) < 1e-10);
});

test('appearance, slight fading and lamp pulse stay bounded and finish invisible', () => {
  const samples = Array.from({ length: 1401 }, (_, index) => sampleFlight(index / 100));
  assert.equal(samples[0].opacity, 0);
  assert.equal(samples.at(-1).opacity, 0);
  const middle = samples.slice(150, 1200);
  assert.ok(middle.every(({ opacity }) => opacity >= 0.779 && opacity <= 1));
  assert.ok(Math.max(...middle.map(({ opacity }) => opacity)) > 0.99);
  assert.ok(Math.min(...middle.map(({ opacity }) => opacity)) < 0.8);
  assert.ok(Math.max(...samples.map(({ lamp }) => lamp)) > 0.99);
  assert.ok(Math.min(...samples.map(({ lamp }) => lamp)) < 0.09);
  assert.equal(samples.at(-1).done, true);
});

test('absolute time is independent of frame rate, with safe endpoints and custom duration', () => {
  assert.deepEqual(sampleFlight(-100), sampleFlight(0));
  assert.deepEqual(sampleFlight(1.75), sampleFlight(105 / 60));
  assert.deepEqual(sampleFlight(1.75), sampleFlight(252 / 144));
  assert.equal(sampleFlight(20, 20).opacity, 0);
  assert.equal(sampleFlight(21, 20).done, true);
  for (const [time, duration] of [
    [NaN, 14],
    [1, 0],
    [1, Infinity],
  ]) {
    assert.throws(() => sampleFlight(time, duration), RangeError);
  }
});
