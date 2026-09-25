/** Anything parseFile accepts. */
export type ImportInput = File | Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array>;

function isReadableStream(x: unknown): x is ReadableStream<Uint8Array> {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as ReadableStream).getReader === "function"
  );
}

function isBlobLike(x: unknown): x is Blob {
  return (
    typeof x === "object" &&
    x !== null &&
    typeof (x as Blob).size === "number" &&
    typeof (x as Blob).type === "string" &&
    (typeof (x as Blob).arrayBuffer === "function" ||
      typeof (x as Blob).slice === "function")
  );
}

function readBlobWithFileReader(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsArrayBuffer(blob);
  });
}

async function readWebStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      parts.push(value);
      total += value.byteLength;
    }
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.byteLength;
  }
  return out;
}

/** Reads any supported input fully into bytes. */
export async function readInputBytes(input: ImportInput): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (isReadableStream(input)) return readWebStream(input);
  if (isBlobLike(input)) {
    const buf =
      typeof input.arrayBuffer === "function"
        ? await input.arrayBuffer()
        : await readBlobWithFileReader(input);
    return new Uint8Array(buf);
  }
  throw new TypeError("Unsupported input: expected File, Blob, ArrayBuffer or ReadableStream");
}

/** UTF-8 decode, stripping a leading BOM. */
export function decodeUtf8(bytes: Uint8Array): string {
  const text = new TextDecoder("utf-8").decode(bytes);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
