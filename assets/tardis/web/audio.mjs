/** Fit the original recording to the flight without changing its pitch. */
export function playbackRateFor(trackDuration, flightDuration) {
  if (
    !Number.isFinite(trackDuration) ||
    trackDuration <= 0 ||
    !Number.isFinite(flightDuration) ||
    flightDuration <= 0
  ) {
    throw new RangeError('Audio and flight durations must be finite and positive.');
  }
  return trackDuration / flightDuration;
}

export function audioEnvelope(seconds, duration) {
  return Math.max(0, Math.min(1, seconds / 0.1, (duration - seconds) / 0.35));
}

export function createFlightAudio(audio, duration, onError) {
  const original = {
    volume: audio.volume,
    playbackRate: audio.playbackRate,
    preservesPitch: audio.preservesPitch,
    loop: audio.loop,
  };
  let disposed = false;
  let position = 0;
  function configure() {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    audio.playbackRate = playbackRateFor(audio.duration, duration);
    audio.preservesPitch = true;
    audio.loop = false;
  }
  function report(error) {
    if (!disposed && error.name !== 'AbortError') onError(error);
  }
  function resume() {
    if (disposed) return;
    configure();
    audio.play().catch(report);
  }
  function seek(seconds) {
    position = Math.max(0, Math.min(duration, seconds));
    configure();
    if (Number.isFinite(audio.duration)) {
      audio.currentTime = Math.min(audio.duration, position * audio.playbackRate);
    }
    audio.volume = original.volume * audioEnvelope(position, duration);
  }
  function metadataLoaded() {
    configure();
    seek(position);
  }
  function mediaError() {
    onError(new Error(audio.error?.message || 'Unable to decode the TARDIS recording.'));
  }
  audio.addEventListener('loadedmetadata', metadataLoaded);
  audio.addEventListener('error', mediaError);
  configure();
  return {
    start() {
      audio.pause();
      seek(0);
      audio.currentTime = 0;
      resume();
    },
    resume,
    seek,
    update(seconds) {
      position = seconds;
      audio.volume = original.volume * audioEnvelope(seconds, duration);
    },
    pause() {
      audio.pause();
    },
    stop() {
      audio.pause();
      seek(0);
      audio.currentTime = 0;
    },
    dispose() {
      disposed = true;
      audio.pause();
      audio.currentTime = 0;
      audio.removeEventListener('loadedmetadata', metadataLoaded);
      audio.removeEventListener('error', mediaError);
      Object.assign(audio, original);
    },
  };
}
