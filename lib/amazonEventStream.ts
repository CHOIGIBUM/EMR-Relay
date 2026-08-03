const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function stringHeader(name: string, value: string) {
  const encoder = new TextEncoder();
  const nameBytes = encoder.encode(name);
  const valueBytes = encoder.encode(value);
  const header = new Uint8Array(1 + nameBytes.length + 1 + 2 + valueBytes.length);
  const view = new DataView(header.buffer);
  header[0] = nameBytes.length;
  header.set(nameBytes, 1);
  header[1 + nameBytes.length] = 7;
  view.setUint16(2 + nameBytes.length, valueBytes.length, false);
  header.set(valueBytes, 4 + nameBytes.length);
  return header;
}

export function encodeAudioEvent(pcm: ArrayBuffer) {
  const headers = [
    stringHeader(":message-type", "event"),
    stringHeader(":event-type", "AudioEvent"),
    stringHeader(":content-type", "application/octet-stream"),
  ];
  const headerLength = headers.reduce((total, header) => total + header.length, 0);
  const totalLength = 16 + headerLength + pcm.byteLength;
  const message = new Uint8Array(totalLength);
  const view = new DataView(message.buffer);
  view.setUint32(0, totalLength, false);
  view.setUint32(4, headerLength, false);
  view.setUint32(8, crc32(message.subarray(0, 8)), false);
  let offset = 12;
  for (const header of headers) { message.set(header, offset); offset += header.length; }
  message.set(new Uint8Array(pcm), offset);
  view.setUint32(totalLength - 4, crc32(message.subarray(0, totalLength - 4)), false);
  return message.buffer;
}

export type EventStreamMessage = { headers: Record<string, string>; payload: Uint8Array };

export function decodeEventStreamMessages(buffer: ArrayBuffer): EventStreamMessage[] {
  const bytes = new Uint8Array(buffer);
  const decoder = new TextDecoder();
  const messages: EventStreamMessage[] = [];
  let frameStart = 0;
  while (frameStart + 16 <= bytes.length) {
    const view = new DataView(bytes.buffer, bytes.byteOffset + frameStart);
    const totalLength = view.getUint32(0, false);
    const headersLength = view.getUint32(4, false);
    if (totalLength < 16 || frameStart + totalLength > bytes.length) break;
    const headers: Record<string, string> = {};
    let offset = frameStart + 12;
    const headersEnd = offset + headersLength;
    while (offset < headersEnd) {
      const nameLength = bytes[offset];
      const name = decoder.decode(bytes.subarray(offset + 1, offset + 1 + nameLength));
      const typeOffset = offset + 1 + nameLength;
      const type = bytes[typeOffset];
      if (type !== 7) break;
      const valueLength = new DataView(bytes.buffer, bytes.byteOffset + typeOffset + 1, 2).getUint16(0, false);
      const valueStart = typeOffset + 3;
      headers[name] = decoder.decode(bytes.subarray(valueStart, valueStart + valueLength));
      offset = valueStart + valueLength;
    }
    messages.push({ headers, payload: bytes.slice(headersEnd, frameStart + totalLength - 4) });
    frameStart += totalLength;
  }
  return messages;
}
