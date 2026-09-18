import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { get, put } from "@vercel/blob";
import { MEDIA_MAX_BYTES } from "./engine/config";

// Private Vercel Blob when configured (production); local disk otherwise. Either way every read
// goes through the access-checked /media route — files are never publicly addressable.
const blobConfigured = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);
export const MEDIA_DIR = path.join(process.cwd(), "storage", "lot-media");
const BLOB_PREFIX = "lot-media/";

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  { mime: "image/jpeg", ext: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/png", ext: "png", test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: "image/webp", ext: "webp", test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

export type SavedMedia = { mimeType: string; sizeBytes: number; sha256: string; storedAs: string };

// Validates by content, not by the client-supplied type or name.
export async function saveImage(file: File): Promise<SavedMedia | { error: string }> {
  if (file.size === 0) return { error: "Choose a photo to upload." };
  if (file.size > MEDIA_MAX_BYTES) return { error: `Photo is too large (max ${MEDIA_MAX_BYTES / 1024 / 1024} MB).` };
  const bytes = Buffer.from(await file.arrayBuffer());
  const kind = SIGNATURES.find((s) => s.test(bytes));
  if (!kind) return { error: "Only JPEG, PNG or WebP photos are accepted." };

  const name = `${randomUUID()}.${kind.ext}`;
  let storedAs: string;
  if (blobConfigured()) {
    const blob = await put(`${BLOB_PREFIX}${name}`, bytes, { access: "private", contentType: kind.mime, addRandomSuffix: false });
    storedAs = blob.pathname;
  } else {
    await mkdir(MEDIA_DIR, { recursive: true });
    await writeFile(path.join(MEDIA_DIR, name), bytes, { flag: "wx" });
    storedAs = name;
  }
  return {
    mimeType: kind.mime,
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    storedAs,
  };
}

const NAME = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;

export async function readImage(storedAs: string): Promise<Buffer | null> {
  try {
    if (storedAs.startsWith(BLOB_PREFIX)) {
      if (!NAME.test(storedAs.slice(BLOB_PREFIX.length)) || !blobConfigured()) return null;
      const res = await get(storedAs, { access: "private" });
      if (!res || res.statusCode !== 200) return null;
      return Buffer.from(await new Response(res.stream).arrayBuffer());
    }
    if (!NAME.test(storedAs)) return null;
    return await readFile(path.join(MEDIA_DIR, storedAs));
  } catch (e) {
    console.error("[media] read failed", e);
    return null;
  }
}
