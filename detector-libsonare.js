/*
 * Tempo detection via libsonare (Apache-2.0), loaded from a CDN at runtime.
 * https://github.com/libraz/libsonare
 *
 * Uses analyzeBpm rather than detectBpm. detectBpm returns a bare number and
 * octave-errors badly — on a 180 BPM source it reports 89.6. analyzeBpm gets
 * that same source right, and more usefully returns a confidence score and a
 * ranked list of candidate tempos, which is what lets the tracker resolve
 * half and double-speed readings instead of guessing.
 */

const MODULE_URL = 'https://cdn.jsdelivr.net/npm/@libraz/libsonare/+esm';

export const libsonareDetector = {
  name: 'libsonare analyzeBpm',
  _lib: null,

  async init() {
    const lib = await import(/* @vite-ignore */ MODULE_URL);
    await lib.init();
    if (typeof lib.analyzeBpm !== 'function') {
      throw new Error('analyzeBpm not exported — check the libsonare API surface');
    }
    this._lib = lib;
  },

  /**
   * @returns {{bpm: number, confidence: number,
   *            candidates: Array<{bpm: number, confidence: number}>} | null}
   */
  analyse(samples, sampleRate) {
    const result = this._lib.analyzeBpm(samples, sampleRate);
    if (!result || !Number.isFinite(result.bpm) || result.bpm <= 0) return null;

    // The full result also carries autocorrelation and tempogram arrays, which
    // are large and unused here — deliberately dropped rather than passed on.
    return {
      bpm: result.bpm,
      confidence: Number.isFinite(result.confidence) ? result.confidence : 0,
      candidates: Array.isArray(result.candidates) ? result.candidates : [],
    };
  },
};
