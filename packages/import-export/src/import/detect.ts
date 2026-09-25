const XLSX_EXTENSIONS = new Set(["xlsx", "xlsm"]);
const CSV_EXTENSIONS = new Set(["csv", "tsv", "txt"]);

function extensionOf(name: string): string | undefined {
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return undefined;
  return name.slice(idx + 1).toLowerCase();
}

function nameOf(input: unknown): string | undefined {
  if (
    input &&
    typeof input === "object" &&
    "name" in input &&
    typeof (input as { name: unknown }).name === "string"
  ) {
    return (input as { name: string }).name;
  }
  return undefined;
}

function hasZipSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

/** Detects whether an input should be parsed as csv or xlsx. */
export function detectFileType(
  input: unknown,
  bytes: Uint8Array,
  hint?: "csv" | "xlsx",
): "csv" | "xlsx" {
  if (hint) return hint;

  const name = nameOf(input);
  if (name) {
    const ext = extensionOf(name);
    if (ext && XLSX_EXTENSIONS.has(ext)) return "xlsx";
    if (ext && CSV_EXTENSIONS.has(ext)) return "csv";
  }

  if (hasZipSignature(bytes)) return "xlsx";

  return "csv";
}
