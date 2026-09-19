/*
 * cgbpm's own tempogram algorithm, migrated to JS on libsonare primitives.
 *
 * This is the dominant term of audio_bpm/audio_player_with_tempo.py's ensemble
 * (`0.6 * plp_median`), reproduced step for step:
 *
 *     onset envelope -> tempogram -> per-frame dominant tempo
 *                    -> clamp to [BPM_MIN, BPM_MAX] -> median
 *
 * The DP beat tracker that contributes the other 0.4 is not exposed by
 * libsonare, so it is absent here. The clamp-then-median ordering is the part
 * that matters most: filtering a distribution of per-frame estimates before
 * aggregating is what makes the Python version resistant to octave errors,
 * and it is exactly what a scalar from analyzeBpm cannot offer.
 *
 * Two details established empirically against libsonare, not from its docs:
 *
 *   - tempogram() takes an ONSET ENVELOPE, not raw audio. Passing samples
 *     yields one frame per sample (67M floats for 4 seconds).
 *   - Its `data` is LAG-MAJOR: data[lag * nFrames + frame], matching librosa's
 *     (win_length, n_frames) shape. Frame-major indexing returns nonsense.
 *
 * Verified on synthetic click tracks: 60 -> 60.1, 90 -> 90.7, 126 -> 126.0,
 * 180 -> 178.2.
 */

import { BPM_MIN, BPM_MAX } from './tempo-tracker.js';

const MODULE_URL = 'https://cdn.jsdelivr.net/npm/@libraz/libsonare/+esm';
const HOP_LENGTH = 512; // matches hop_length in the Python implementation

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export const tempogramDetector = {
  name: 'cgbpm tempogram (migrated)',
  _lib: null,

  async init() {
    const lib = await import(/* @vite-ignore */ MODULE_URL);
    await lib.init();
    this._lib = lib;
  },

  analyse(samples, sampleRate) {
    const lagToBpm = (lag) => (60 * sampleRate) / (HOP_LENGTH * lag);
    // Search only lags that correspond to a plausible tempo, rather than taking
    // a global argmax and discarding out-of-range results afterwards.
    const lagMin = Math.max(1, Math.floor((60 * sampleRate) / (HOP_LENGTH * BPM_MAX)));
    const lagMax = Math.ceil((60 * sampleRate) / (HOP_LENGTH * BPM_MIN));

    const envelope = this._lib.onsetEnvelope(samples, sampleRate, HOP_LENGTH);
    const { nFrames, winLength, data } = this._lib.tempogram(envelope, sampleRate, HOP_LENGTH);

    const perFrame = [];
    const highestLag = Math.min(lagMax, winLength - 1);
    for (let frame = 0; frame < nFrames; frame++) {
      let bestLag = -1;
      let bestValue = -Infinity;
      for (let lag = lagMin; lag <= highestLag; lag++) {
        const value = data[lag * nFrames + frame];
        if (value > bestValue) {
          bestValue = value;
          bestLag = lag;
        }
      }
      if (bestLag > 0) perFrame.push(lagToBpm(bestLag));
    }

    if (perFrame.length === 0) return null;

    // Confidence stands in for the Python version's beat-count check: how much
    // of the window agreed on the tempo that was ultimately chosen.
    const chosen = median(perFrame);
    const agreeing = perFrame.filter((bpm) => Math.abs(bpm / chosen - 1) < 0.08).length;

    return {
      bpm: chosen,
      confidence: agreeing / perFrame.length,
      candidates: [], // per-frame median already aggregates; nothing to rank
    };
  },
};
