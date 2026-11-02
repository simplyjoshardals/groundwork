/**
 * Builds a minimal valid text PDF in memory so tests can control the exact
 * page count and per-page text (including blank pages) without a new binary
 * fixture. One entry per page; "" makes a blank page. ASCII text only.
 */
export function buildPdf(pages: readonly string[]): Uint8Array {
  const escape = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`);

  const contentFor = (text: string): string => {
    const lines = text.match(/.{1,90}(\s|$)/g) ?? [];
    const ops = lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map(
        (line, i) =>
          `BT /F1 10 Tf 40 ${800 - i * 12} Td (${escape(line)}) Tj ET`,
      );
    return ops.join("\n");
  };

  // Object numbers: 1 catalog, 2 page tree, 3 font, then (page, content) pairs.
  const objects: string[] = [];
  const pageObj = (n: number) => 4 + n * 2;
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Count ${pages.length} /Kids [${pages
    .map((_, n) => `${pageObj(n)} 0 R`)
    .join(" ")}] >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  pages.forEach((text, n) => {
    const stream = contentFor(text);
    objects[pageObj(n)] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ` +
      `/Resources << /Font << /F1 3 0 R >> >> /Contents ${pageObj(n) + 1} 0 R >>`;
    objects[pageObj(n) + 1] =
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });

  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (let i = 1; i < objects.length; i++) {
    offsets[i] = out.length;
    out += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefAt = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < objects.length; i++) {
    out += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** Dense filler text, comfortably above the scanned-PDF threshold. */
export function denseText(label: string): string {
  return `${label} ${"alpha beta gamma delta epsilon ".repeat(12)}`;
}
