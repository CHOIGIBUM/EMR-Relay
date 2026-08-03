class EmsRelayPcmProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.outputRate = options.processorOptions?.outputSampleRate || 16000;
    this.ratio = sampleRate / this.outputRate;
    this.tail = new Float32Array(0);
    // 90 ms at 16 kHz. This avoids sending a WebSocket frame for every
    // 128-sample render quantum while keeping PTT latency below 100 ms.
    this.batchSamples = Math.round(this.outputRate * 0.09);
    this.batch = new Int16Array(this.batchSamples);
    this.batchOffset = 0;
    this.port.onmessage = (event) => {
      if (event.data?.type !== "flush") return;
      this.flushBatch();
      this.port.postMessage({ type: "flushed" });
    };
  }

  emit(pcm) {
    let sourceOffset = 0;
    while (sourceOffset < pcm.length) {
      const writable = Math.min(this.batch.length - this.batchOffset, pcm.length - sourceOffset);
      this.batch.set(pcm.subarray(sourceOffset, sourceOffset + writable), this.batchOffset);
      this.batchOffset += writable;
      sourceOffset += writable;
      if (this.batchOffset === this.batch.length) {
        const completed = this.batch;
        this.batch = new Int16Array(this.batchSamples);
        this.batchOffset = 0;
        this.port.postMessage(completed.buffer, [completed.buffer]);
      }
    }
  }

  flushBatch() {
    if (!this.batchOffset) return;
    const remaining = this.batch.slice(0, this.batchOffset);
    this.batch = new Int16Array(this.batchSamples);
    this.batchOffset = 0;
    this.port.postMessage(remaining.buffer, [remaining.buffer]);
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;
    const combined = new Float32Array(this.tail.length + channel.length);
    combined.set(this.tail);
    combined.set(channel, this.tail.length);
    const outputLength = Math.floor(combined.length / this.ratio);
    if (!outputLength) { this.tail = combined; return true; }
    const pcm = new Int16Array(outputLength);
    for (let out = 0; out < outputLength; out += 1) {
      const start = Math.floor(out * this.ratio);
      const end = Math.max(start + 1, Math.floor((out + 1) * this.ratio));
      let sum = 0;
      for (let index = start; index < end && index < combined.length; index += 1) sum += combined[index];
      const sample = Math.max(-1, Math.min(1, sum / Math.max(1, end - start)));
      pcm[out] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }
    const consumed = Math.floor(outputLength * this.ratio);
    this.tail = combined.slice(consumed);
    this.emit(pcm);
    return true;
  }
}

registerProcessor("ems-relay-pcm", EmsRelayPcmProcessor);
