import type { Readable } from "node:stream";

/** Collect a Node Readable into bytes. */
export async function collectNodeStream(stream: Readable): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk as Uint8Array));
  }
  return new Uint8Array(Buffer.concat(chunks));
}

/** Collect a web ReadableStream into bytes. */
export async function collectWebStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    total += value.byteLength;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/** A web ReadableStream that yields `bytes` in `chunkSize` pieces. */
export function webStreamOf(bytes: Uint8Array, chunkSize = 7): ReadableStream<Uint8Array> {
  let off = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (off >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(off, off + chunkSize));
      off += chunkSize;
    },
  });
}

/** Copy bytes into a fresh, exactly-sized ArrayBuffer. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}
