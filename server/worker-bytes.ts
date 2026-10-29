export type VoiceViWorkerBytes = ArrayBuffer;

export function bufferToWorkerBytes(buffer: Buffer): VoiceViWorkerBytes {
  const bytes = new Uint8Array(buffer.byteLength);
  bytes.set(buffer);
  return bytes.buffer;
}

export function workerBytesToBuffer(bytes: VoiceViWorkerBytes): Buffer {
  return Buffer.from(bytes);
}
