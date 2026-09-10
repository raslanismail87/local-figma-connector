import { MAX_MESSAGE_BYTES, type Response } from '../src/protocol.js';

export const MAX_OUTGOING_BYTES = MAX_MESSAGE_BYTES - 1024;

export function utf8ByteLength(value: string, stopAfter = Infinity): number {
  let bytes = 0;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length && value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index++;
    } else bytes += 3;
    if (bytes > stopAfter) return bytes;
  }
  return bytes;
}

export function serializeWithinLimit(value: unknown): string | undefined {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || utf8ByteLength(serialized, MAX_OUTGOING_BYTES) > MAX_OUTGOING_BYTES) return undefined;
  return serialized;
}

export function boundedResponse(response: Response, operation?: string): Response {
  if (serializeWithinLimit(response) !== undefined) return response;
  return {
    type: 'response', requestId: response.requestId, ok: false,
    error: {
      code: operation === 'read' ? 'READ_TOO_LARGE' : 'RESPONSE_TOO_LARGE',
      message: 'The result exceeds the local bridge message limit. Reduce maxNodes, maxTextLength, or depth for reads; export fewer or smaller nodes for previews.'
    }
  };
}
