// "Each compressed file is exactly ONE complete zstd stream. Concatenated streams, truncated
// files and trailing bytes are rejected." — the Hub's rule, checked WITHOUT decompressing.
//
// A zstd frame is self-delimiting: magic, a header whose size its first byte encodes, then
// blocks whose 3-byte headers carry their own sizes, then an optional 4-byte checksum. Walking
// those headers finds where the frame ends, so a multi-GiB file costs a few KiB of reads.
// Spec: RFC 8878 §3.1.

const ZSTD_MAGIC = 0xfd2fb528;
const SKIPPABLE_MIN = 0x184d2a50;
const SKIPPABLE_MAX = 0x184d2a5f;

/** Random access to the compressed bytes — a buffer, or a file handle in Node. */
export type ByteReader = (offset: number, length: number) => Promise<Uint8Array>;

export interface FrameInspection {
  /** Complete zstd frames found (1 is the only legal answer). */
  frames: number;
  /** Skippable frames found (never legal here — they are extra streams). */
  skippable: number;
  /** Bytes after the last complete frame. */
  trailing: number;
  /** Set when the structure is broken (truncated, bad magic, reserved bits). */
  error?: string;
  /** Declared decompressed size of the first frame, when the header carries one. */
  contentSize?: number;
}

export function bufferReader(buf: Uint8Array): ByteReader {
  return async (offset, length) => buf.subarray(offset, Math.min(buf.length, offset + length));
}

const u32le = (b: Uint8Array, i = 0): number => (b[i]! | (b[i + 1]! << 8) | (b[i + 2]! << 16) | (b[i + 3]! << 24)) >>> 0;

/** Walk every frame in `size` bytes. Never throws. */
export async function inspectZstdFrames(read: ByteReader, size: number): Promise<FrameInspection> {
  const out: FrameInspection = { frames: 0, skippable: 0, trailing: 0 };
  let pos = 0;
  while (pos < size) {
    if (size - pos < 4) {
      out.trailing = size - pos;
      return out;
    }
    const magic = u32le(await read(pos, 4));
    if (magic >= SKIPPABLE_MIN && magic <= SKIPPABLE_MAX) {
      const hdr = await read(pos + 4, 4);
      if (hdr.length < 4) return { ...out, error: 'truncated skippable frame header' };
      out.skippable++;
      pos += 8 + u32le(hdr);
      continue;
    }
    if (magic !== ZSTD_MAGIC) {
      // Garbage after a valid frame is "trailing bytes"; garbage at the start is not zstd at all.
      if (out.frames === 0) return { ...out, error: 'not a zstd stream (bad magic number)' };
      out.trailing = size - pos;
      return out;
    }
    pos += 4;
    const fhd = (await read(pos, 1))[0];
    if (fhd === undefined) return { ...out, error: 'truncated frame header' };
    pos += 1;
    const fcsFlag = fhd >> 6;
    const singleSegment = (fhd >> 5) & 1;
    const reserved = (fhd >> 3) & 1;
    const checksum = (fhd >> 2) & 1;
    const dictFlag = fhd & 3;
    if (reserved) return { ...out, error: 'reserved bit set in frame header' };
    const windowBytes = singleSegment ? 0 : 1;
    const dictBytes = [0, 1, 2, 4][dictFlag]!;
    const fcsBytes = fcsFlag === 0 ? (singleSegment ? 1 : 0) : [0, 2, 4, 8][fcsFlag]!;
    if (out.frames === 0 && fcsBytes > 0) {
      const f = await read(pos + windowBytes + dictBytes, fcsBytes);
      let v = 0;
      for (let i = fcsBytes - 1; i >= 0; i--) v = v * 256 + (f[i] ?? 0);
      out.contentSize = fcsBytes === 2 ? v + 256 : v;
    }
    pos += windowBytes + dictBytes + fcsBytes;
    // Blocks.
    for (;;) {
      if (pos + 3 > size) return { ...out, error: 'truncated: the last block is missing' };
      const b = await read(pos, 3);
      const header = b[0]! | (b[1]! << 8) | (b[2]! << 16);
      const last = header & 1;
      const type = (header >> 1) & 3;
      const blockSize = header >>> 3;
      pos += 3;
      if (type === 3) return { ...out, error: 'reserved block type' };
      pos += type === 1 ? 1 : blockSize; // RLE stores one byte; raw/compressed store blockSize
      if (pos > size) return { ...out, error: 'truncated: a block runs past the end of the file' };
      if (last) break;
    }
    if (checksum) {
      pos += 4;
      if (pos > size) return { ...out, error: 'truncated: the content checksum is missing' };
    }
    out.frames++;
  }
  return out;
}

/** Turn an inspection into a single human verdict (undefined = exactly one clean frame). */
export function frameProblem(i: FrameInspection): string | undefined {
  if (i.error) return i.error;
  if (i.frames === 0) return 'no zstd frame found';
  if (i.frames > 1) return `${i.frames} concatenated zstd frames — the file must be exactly one stream (compress the whole file in one go)`;
  if (i.skippable) return 'contains a skippable frame — the file must be exactly one stream';
  if (i.trailing) return `${i.trailing} trailing byte(s) after the zstd frame`;
  return undefined;
}
