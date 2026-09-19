/*
 * AudioWorklet processor: batches raw PCM back to the main thread.
 *
 * The audio graph hands us 128-sample blocks, which would be ~375 messages per
 * second at 48 kHz. Batching to BATCH_SIZE keeps the message rate sane while
 * still delivering audio far faster than the analysis hop needs.
 */

const BATCH_SIZE = 4096;

class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this._batch = new Float32Array(BATCH_SIZE);
    this._filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true; // source not producing yet — keep the node alive

    for (let i = 0; i < channel.length; i++) {
      this._batch[this._filled++] = channel[i];
      if (this._filled === BATCH_SIZE) {
        // slice() copies: the batch buffer is reused on the next block.
        this.port.postMessage(this._batch.slice());
        this._filled = 0;
      }
    }
    return true;
  }
}

registerProcessor('pcm-tap', PcmTap);
