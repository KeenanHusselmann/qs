/**
 * The words in a PDF's pictures – read by OCR, so a fee table pasted in as a screenshot is read.
 *
 * A proposal that shows its fee calculation as an image has, as far as its text goes, no fee
 * calculation; the Lemken proposal did exactly that, and its fee could not be checked until a
 * person read the picture. This reads each embedded image with Tesseract and returns what it read
 * with how sure it was.
 *
 * Only what reads cleanly is kept. A site plan run through OCR is a page of noise ("4 a = Ym ~S ba")
 * at a confidence in the thirties and forties; a table or a letterhead reads in the seventies and
 * eighties. Below the threshold the image is reported as unread rather than guessed at – the same
 * rule as everywhere else here.
 */

import { tmpdir } from "node:os";

export interface ImageText {
  page: number;
  /** What Tesseract read, as it read it – misreads included. */
  text: string;
  /** 0–100, Tesseract's own mean word confidence. */
  confidence: number;
}

export interface ImageReading {
  read: ImageText[];
  /** Images large enough to matter that did not read cleanly – drawings, photographs, scans too faint. */
  unread: { page: number; confidence: number }[];
}

const MIN_PIXELS = 40_000;
const MIN_CONFIDENCE = 60;
const MAX_IMAGES = 16;
/** A logo that does not read is not a gap in the proposal; a drawing or a table that does not read is. */
const MATERIAL_PIXELS = 150_000;

export async function imageText(bytes: Uint8Array, { signal }: { signal?: AbortSignal } = {}): Promise<ImageReading> {
  const { getDocumentProxy, extractImages } = await import("unpdf");
  const sharp = (await import("sharp")).default;
  const { createWorker } = await import("tesseract.js");

  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  const read: ImageText[] = [];
  const unread: ImageReading["unread"] = [];
  const seen = new Set<string>();
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;
  let done = 0;

  try {
    for (let page = 1; page <= pdf.numPages && done < MAX_IMAGES; page++) {
      if (signal?.aborted) break;
      for (const image of await extractImages(pdf, page)) {
        if (image.width * image.height < MIN_PIXELS || done >= MAX_IMAGES) continue;
        // A letterhead repeats on every page: read it once.
        const key = `${image.width}x${image.height}:${Buffer.from(image.data.subarray(0, 256)).toString("base64")}`;
        if (seen.has(key)) continue;
        seen.add(key);
        done++;

        // Tesseract reads best at print resolution; a screenshot pasted at 96 dpi is enlarged first.
        const png = await sharp(Buffer.from(image.data), { raw: { width: image.width, height: image.height, channels: image.channels } })
          .resize({ width: Math.max(image.width, 1800) })
          .greyscale()
          .png()
          .toBuffer();
        worker ??= await createWorker("eng", undefined, { cachePath: tmpdir() });
        const { data } = await worker.recognize(png);
        const text = data.text.trim();
        if (data.confidence >= MIN_CONFIDENCE && text.length >= 20) read.push({ page, text, confidence: Math.round(data.confidence) });
        else if (image.width * image.height >= MATERIAL_PIXELS) unread.push({ page, confidence: Math.round(data.confidence) });
      }
    }
  } finally {
    await worker?.terminate();
  }
  return { read, unread };
}
