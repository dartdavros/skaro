import assert from 'node:assert/strict';
import test from 'node:test';
import { audioEnvelope, playbackRateFor } from './audio.mjs';

test('the supplied recording fits the full flight without looping or truncation', () => {
  const recording = 12.956735;
  assert.ok(Math.abs(14 * playbackRateFor(recording, 14) - recording) < 1e-10);
  assert.ok(playbackRateFor(recording, 14) < 1);
  for (const invalid of [NaN, 0, -1, Infinity]) {
    assert.throws(() => playbackRateFor(invalid, 14), RangeError);
    assert.throws(() => playbackRateFor(recording, invalid), RangeError);
  }
});

test('sound fades at the endpoints and stays at original volume during flight', () => {
  for (const seconds of [-1, 0, 14, 15]) assert.equal(audioEnvelope(seconds, 14), 0);
  for (const seconds of [0.1, 1, 7, 13]) assert.equal(audioEnvelope(seconds, 14), 1);
  assert.equal(audioEnvelope(0.05, 14), 0.5);
  assert.ok(Math.abs(audioEnvelope(13.825, 14) - 0.5) < 1e-10);
});
