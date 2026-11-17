/**
 * Which filed drawings the drawing reader takes: a PDF plotted from CAD, or an ASCII DXF.
 *
 * Shared by the page, which lists only these, and the server action, which refuses anything else
 * whatever the page sent. A .dwg is filed and kept, and still not read (PLATFORM.md §10.5).
 */
export const READABLE_DRAWING_EXTENSIONS = ["pdf", "dxf"] as const;

export const isReadableDrawing = (filename: string): boolean =>
  (READABLE_DRAWING_EXTENSIONS as readonly string[]).includes(filename.toLowerCase().split(".").pop() ?? "");
