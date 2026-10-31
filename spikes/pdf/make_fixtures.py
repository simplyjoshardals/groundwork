#!/usr/bin/env python3
"""
Generates the SYNTHETIC test PDFs for Task 0.6 into spikes/pdf/fixtures/.

The text is about a fictional company, so nothing private is ever involved.
Each text PDF also gets <name>.expected.json: the source fragments of every
page in reading order, used by spikes/pdf/score.ts to score extraction.

Needs: Python 3, reportlab, Pillow, qpdf, pdftoppm (poppler).
The generated files are committed, so you only rerun this to change them:
    python3 spikes/pdf/make_fixtures.py

Synthetic PDFs are cleaner than real-world ones (no odd fonts, no layout
quirks), so results are a baseline, not a guarantee.
"""
import json
import random
import subprocess
import tempfile
from pathlib import Path

from PIL import Image
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas
from reportlab.platypus import Frame, Paragraph, Table, TableStyle
from reportlab.lib import colors
from reportlab.lib.utils import simpleSplit

OUT = Path(__file__).resolve().parent / "fixtures"
PAGE_W, PAGE_H = A4
MARGIN = 20 * mm
BODY = ParagraphStyle("body", fontName="Helvetica", fontSize=10.5, leading=14)
FONT = ("Helvetica", 10.5)
LEADING = 14

NOUNS = ["parking permit", "laptop refresh", "visitor badge", "printer queue",
         "meeting room", "bicycle store", "recycling rota", "help desk",
         "expense claim", "fire drill", "newsletter", "book exchange",
         "plant rota", "key register", "lost property", "kitchen cleaning"]
ADJ = ["quarterly", "annual", "monthly", "weekly", "provisional", "revised"]
TEAMS = ["facilities group", "people team", "finance office", "site committee",
         "operations desk", "safety panel"]


def sentences(seed: int, count: int) -> list[str]:
    """Deterministic, distinctive sentences (each is unique across the set)."""
    rnd = random.Random(seed)
    out = []
    for i in range(count):
        noun = rnd.choice(NOUNS)
        out.append(
            f"Brindlemoor note {seed}.{i + 1}: the {rnd.choice(ADJ)} {noun} "
            f"policy is reviewed every {rnd.randint(2, 40)} weeks by the "
            f"{rnd.choice(TEAMS)} and logged under reference {rnd.randint(1000, 9999)}."
        )
    return out


def write_expected(name: str, kind: str, pages: list[list[str]]) -> None:
    data = {
        "file": f"{name}.pdf",
        "kind": kind,
        "pages": [{"page": i + 1, "fragments": f} for i, f in enumerate(pages)],
    }
    (OUT / f"{name}.expected.json").write_text(json.dumps(data, indent=2) + "\n")


def new_canvas(path: Path) -> canvas.Canvas:
    # invariant=1 removes timestamps so reruns give identical bytes.
    return canvas.Canvas(str(path), pagesize=A4, invariant=1, pageCompression=1)


def heading(c: canvas.Canvas, text: str) -> None:
    c.setFont("Helvetica-Bold", 14)
    c.drawString(MARGIN, PAGE_H - MARGIN, text)


# --------------------------------------------------------------- single column
def single_column_pages(path: Path, pages: int, per_page: int, seed0: int) -> list[list[str]]:
    c = new_canvas(path)
    expected = []
    for p in range(pages):
        sents = sentences(seed0 + p, per_page)
        heading(c, f"Handbook section {p + 1}")
        frame = Frame(MARGIN, MARGIN, PAGE_W - 2 * MARGIN, PAGE_H - 2 * MARGIN - 12 * mm,
                      showBoundary=0)
        story = [Paragraph(" ".join(sents[i:i + 2]), BODY) for i in range(0, per_page, 2)]
        frame.addFromList(story, c)
        assert not story, "page overflow: reduce per_page"
        c.showPage()
        expected.append(sents)
    c.save()
    return expected


# ------------------------------------------------------------------ two column
def two_column(path: Path) -> list[list[str]]:
    c = new_canvas(path)
    col_w = (PAGE_W - 2 * MARGIN - 8 * mm) / 2
    left_x, right_x = MARGIN, MARGIN + col_w + 8 * mm
    expected = []
    for p in range(4):
        left, right = sentences(500 + p * 2, 7), sentences(501 + p * 2, 7)
        interleaved = p >= 2
        heading(c, f"Two-column report, page {p + 1} ({'line-interleaved' if interleaved else 'column order'})")
        top = PAGE_H - MARGIN - 12 * mm
        if not interleaved:
            for x, sents in ((left_x, left), (right_x, right)):
                frame = Frame(x, MARGIN, col_w, top - MARGIN, showBoundary=0,
                              leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
                story = [Paragraph(s, BODY) for s in sents]
                frame.addFromList(story, c)
                assert not story, "column overflow"
        else:
            # Content stream alternates left line, right line (common in real exports).
            lines = [simpleSplit(" ".join(col), *FONT, col_w) for col in (left, right)]
            for i in range(max(len(lines[0]), len(lines[1]))):
                y = top - (i + 1) * LEADING
                assert y > MARGIN, "interleaved page overflow"
                for x, col in ((left_x, lines[0]), (right_x, lines[1])):
                    if i < len(col):
                        c.setFont(*FONT)
                        c.drawString(x, y, col[i])
        c.showPage()
        expected.append(left + right)  # reading order: whole left column, then right
    c.save()
    return expected


# ----------------------------------------------------------------------- table
def table_pdf(path: Path) -> list[list[str]]:
    c = new_canvas(path)
    rnd = random.Random(900)
    expected = []
    for p in range(3):
        heading(c, f"Action register, part {p + 1}")
        rows = [["Item", "Owner", "Due date", "Budget", "Status"]]
        frags = []
        for r in range(14):
            row = [f"{rnd.choice(NOUNS).title()} {p + 1}{r:02d}",
                   rnd.choice(["Dana", "Ife", "Marcus", "Aiko", "Lena", "Tunde"]),
                   f"{rnd.randint(1, 28):02d} {rnd.choice(['Jan', 'Feb', 'Mar', 'Apr', 'May'])} 2027",
                   f"{rnd.randint(100, 9000)}.{rnd.randint(0, 99):02d}",
                   rnd.choice(["Open", "Done", "Blocked", "Review"])]
            rows.append(row)
            frags.append(" ".join(row))
        t = Table(rows, colWidths=[62 * mm, 25 * mm, 32 * mm, 25 * mm, 25 * mm])
        t.setStyle(TableStyle([
            ("FONT", (0, 0), (-1, -1), "Helvetica", 10),
            ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 10),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.grey),
            ("ALIGN", (3, 0), (3, -1), "RIGHT"),
        ]))
        w, h = t.wrapOn(c, PAGE_W - 2 * MARGIN, PAGE_H)
        t.drawOn(c, MARGIN, PAGE_H - MARGIN - 12 * mm - h)
        c.showPage()
        expected.append(["Item Owner Due date Budget Status"] + frags)
    c.save()
    return expected


# --------------------------------------------------------------------- scanned
def scanned(src: Path, dst: Path, pages: int, footer: bool) -> list[list[str]]:
    """Rasterizes the first pages of src into an image-only PDF."""
    with tempfile.TemporaryDirectory() as tmp:
        subprocess.run(["pdftoppm", "-r", "110", "-gray", "-l", str(pages), "-png",
                        str(src), f"{tmp}/p"], check=True)
        c = new_canvas(dst)
        for i, png in enumerate(sorted(Path(tmp).glob("p-*.png"))):
            jpg = Path(tmp) / f"p{i}.jpg"
            Image.open(png).convert("L").save(jpg, "JPEG", quality=45)
            c.drawImage(str(jpg), 0, 0, width=PAGE_W, height=PAGE_H)
            if footer:
                # Scanner software often stamps a page number as real text.
                c.setFont("Helvetica", 8)
                c.drawString(PAGE_W / 2 - 10, 8 * mm, f"Page {i + 1}")
            c.showPage()
        c.save()
    return [[] for _ in range(pages)]


# -------------------------------------------------------------- sparse (slides)
def sparse(path: Path) -> list[list[str]]:
    c = new_canvas(path)
    expected = []
    for p in range(6):
        sents = [f"Slide {p + 1}: quarterly review", f"Owner {p + 1}: facilities group",
                 f"Target {p + 1}: {10 + p * 3} weeks"]
        c.setFont("Helvetica-Bold", 20)
        c.drawString(MARGIN, PAGE_H - 50 * mm, sents[0])
        c.setFont("Helvetica", 14)
        c.drawString(MARGIN, PAGE_H - 70 * mm, sents[1])
        c.drawString(MARGIN, PAGE_H - 80 * mm, sents[2])
        c.showPage()
        expected.append(sents)
    c.save()
    return expected


def run_qpdf(*args: str) -> None:
    subprocess.run(["qpdf", *args], check=True)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)

    p = OUT / "single-column.pdf"
    write_expected("single-column", "single-column", single_column_pages(p, 10, 8, 100))

    write_expected("two-column", "two-column", two_column(OUT / "two-column.pdf"))
    write_expected("table", "table", table_pdf(OUT / "table.pdf"))

    # 30 dense pages for the timing test (about 2,000+ characters per page).
    write_expected("thirty-pages", "single-column", single_column_pages(OUT / "thirty-pages.pdf", 30, 16, 200))

    write_expected("sparse-text", "sparse", sparse(OUT / "sparse-text.pdf"))

    write_expected("scanned", "scanned", scanned(OUT / "single-column.pdf", OUT / "scanned.pdf", 3, False))
    write_expected("scanned-with-footer", "scanned", scanned(OUT / "single-column.pdf", OUT / "scanned-with-footer.pdf", 3, True))

    # Encrypted: user password needed; and owner-password-only (opens freely).
    run_qpdf("--encrypt", "userpw", "ownerpw", "256", "--", str(OUT / "single-column.pdf"), str(OUT / "encrypted-user-password.pdf"))
    run_qpdf("--encrypt", "", "ownerpw", "256", "--print=none", "--", str(OUT / "single-column.pdf"), str(OUT / "encrypted-owner-only.pdf"))
    write_expected("encrypted-owner-only", "single-column", single_column_pages(Path(tempfile.mkdtemp()) / "x.pdf", 10, 8, 100))

    # Corrupt / not-a-PDF inputs.
    data = (OUT / "single-column.pdf").read_bytes()
    (OUT / "corrupt-truncated.pdf").write_bytes(data[: int(len(data) * 0.55)])
    rnd = random.Random(7)
    (OUT / "corrupt-garbage.pdf").write_bytes(b"%PDF-1.7\n" + bytes(rnd.randrange(256) for _ in range(4096)))
    (OUT / "fake-exe.pdf").write_bytes(b"MZ" + bytes(rnd.randrange(256) for _ in range(2048)))

    for f in sorted(OUT.glob("*.pdf")):
        print(f"{f.name:34s}{f.stat().st_size:>10,d} bytes")


if __name__ == "__main__":
    main()
