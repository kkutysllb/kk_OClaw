"""
PDF Processing Skill — generate.py

Handle common PDF tasks using pymupdf (fitz), pymupdf4llm, and pdfplumber:
  - convert-to-markdown  Convert PDF to structured Markdown (preserves headings, tables, formatting)
  - extract-text         Export all raw text from a PDF
  - extract-tables       Extract tables to CSV / JSON
  - merge                Combine multiple PDFs into one
  - split                Split PDF into individual pages or page ranges
  - create               Create a PDF from plain text or Markdown
  - info                 Show metadata and page count
"""

import json
import os
import sys

try:
    import fitz  # pymupdf
except ImportError:
    print("⚠  pymupdf is not installed. Run: pip install pymupdf")
    sys.exit(1)


# ── Helpers ──────────────────────────────────────────────────────────
def _ensure_dir(filepath: str) -> None:
    d = os.path.dirname(filepath)
    if d:
        os.makedirs(d, exist_ok=True)


def _get_page_count(doc: fitz.Document) -> int:
    return doc.page_count if hasattr(doc, "page_count") else len(doc)


# ── convert-to-markdown ──────────────────────────────────────────────
def convert_to_markdown(pdf_path: str, output_path: str) -> str:
    """Convert a PDF to structured Markdown using pymupdf4llm.

    This preserves document structure — headings, tables, bold/italic
    formatting, lists, and inline images — which makes downstream
    analysis (e.g. with read_file + grep) far more accurate than
    raw text extraction.

    Args:
        pdf_path: Path to the source PDF.
        output_path: Output .md file path.
    """
    try:
        import pymupdf4llm
    except ImportError:
        return (
            "Error: pymupdf4llm is required for Markdown conversion. "
            "Install it with: pip install pymupdf4llm"
        )

    try:
        markdown_text = pymupdf4llm.to_markdown(pdf_path)
    except Exception as e:
        return f"Error converting PDF to Markdown: {e}"

    _ensure_dir(output_path)
    with open(output_path, "w", encoding="utf-8") as f:
        f.write(markdown_text)

    # Count pages for the success message
    doc = fitz.open(pdf_path)
    pages = _get_page_count(doc)
    doc.close()

    return (
        f"Converted {pages} page(s) to Markdown "
        f"({len(markdown_text):,} chars) → {output_path}"
    )


# ── extract-text ─────────────────────────────────────────────────────
def extract_text(pdf_path: str, output_path: str, page_range: str = "") -> str:
    """Extract all text from a PDF and save to a .txt or .md file.

    Args:
        pdf_path: Path to the source PDF.
        output_path: Output text file path (.txt or .md).
        page_range: Optional page range, e.g. "1-3" or "1,3,5". Empty = all.
    """
    doc = fitz.open(pdf_path)
    total = _get_page_count(doc)

    pages = list(range(total))
    if page_range:
        selected = set()
        for part in page_range.split(","):
            part = part.strip()
            if "-" in part:
                a, b = part.split("-", 1)
                selected.update(range(int(a) - 1, int(b)))
            elif part:
                selected.add(int(part) - 1)
        pages = [p for p in pages if p in selected]

    _ensure_dir(output_path)
    with open(output_path, "w", encoding="utf-8") as out:
        for idx in pages:
            if idx >= total:
                continue
            text = doc[idx].get_text()
            out.write(text)
            if not text.endswith("\n"):
                out.write("\n")
            out.write("\n")

    doc.close()
    return f"Extracted text from {len(pages)} page(s) → {output_path}"


# ── extract-tables ───────────────────────────────────────────────────
def extract_tables(pdf_path: str, output_path: str, page_range: str = "") -> str:
    """Extract tables from a PDF and save as CSV or JSON.

    Uses pdfplumber for high-quality table detection.
    Falls back gracefully if pdfplumber is not installed.
    """
    try:
        import pdfplumber
    except ImportError:
        return (
            "Error: pdfplumber is required for table extraction. "
            "Install it with: pip install pdfplumber"
        )

    total_pages = 0
    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)

    pages = list(range(total_pages))
    if page_range:
        selected = set()
        for part in page_range.split(","):
            part = part.strip()
            if "-" in part:
                a, b = part.split("-", 1)
                selected.update(range(int(a) - 1, int(b)))
            elif part:
                selected.add(int(part) - 1)
        pages = [p for p in pages if p in selected]

    all_tables: list[dict] = []
    with pdfplumber.open(pdf_path) as pdf:
        for idx in pages:
            page = pdf.pages[idx]
            tables = page.extract_tables()
            for ti, table in enumerate(tables):
                if not table:
                    continue
                rows = [[str(c) if c is not None else "" for c in row] for row in table]
                all_tables.append({
                    "page": idx + 1,
                    "table_index": ti + 1,
                    "rows": rows,
                })

    _ensure_dir(output_path)
    ext = os.path.splitext(output_path)[1].lower()

    if ext == ".json":
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(all_tables, f, ensure_ascii=False, indent=2)
    else:  # .csv
        import csv
        with open(output_path, "w", encoding="utf-8", newline="") as f:
            writer = csv.writer(f)
            for tbl in all_tables:
                writer.writerow([f"# Page {tbl['page']}, Table {tbl['table_index']}"])
                for row in tbl["rows"]:
                    writer.writerow(row)
                writer.writerow([])

    return f"Extracted {len(all_tables)} table(s) from {len(pages)} page(s) → {output_path}"


# ── merge ────────────────────────────────────────────────────────────
def merge_pdfs(input_paths: list[str], output_path: str) -> str:
    """Merge multiple PDF files into one.

    Args:
        input_paths: Ordered list of PDF paths to merge.
        output_path: Output PDF path.
    """
    if not input_paths:
        return "Error: no input PDFs specified."

    merged = fitz.open()
    for path in input_paths:
        src = fitz.open(path)
        merged.insert_pdf(src)
        src.close()

    _ensure_dir(output_path)
    merged.save(output_path)
    merged.close()
    return f"Merged {len(input_paths)} PDF(s) → {output_path}"


# ── split ────────────────────────────────────────────────────────────
def split_pdf(pdf_path: str, output_dir: str, pages_per_file: int = 1) -> str:
    """Split a PDF into multiple files.

    Args:
        pdf_path: Source PDF.
        output_dir: Directory to save split files.
        pages_per_file: Number of pages per output file (default 1).
    """
    doc = fitz.open(pdf_path)
    total = _get_page_count(doc)
    os.makedirs(output_dir, exist_ok=True)

    count = 0
    for start in range(0, total, pages_per_file):
        end = min(start + pages_per_file, total)
        new_doc = fitz.open()
        new_doc.insert_pdf(doc, from_page=start, to_page=end - 1)
        out_name = os.path.join(output_dir, f"part_{start + 1:03d}-{end:03d}.pdf")
        new_doc.save(out_name)
        new_doc.close()
        count += 1

    doc.close()
    return f"Split into {count} file(s) → {output_dir}"


# ── create ───────────────────────────────────────────────────────────
def create_pdf(text_path: str, output_path: str) -> str:
    """Create a PDF from a plain text or Markdown file.

    Note: For Markdown→PDF with rich formatting, consider using a dedicated
    converter (e.g. pandoc). This function produces a simple, readable PDF.
    """
    with open(text_path, "r", encoding="utf-8") as f:
        text = f.read()

    doc = fitz.open()
    # A4 paper: 595 x 842 points
    page = doc.new_page(width=595, height=842)
    margin = 50
    usable_w = 595 - 2 * margin
    usable_h = 842 - 2 * margin

    # Simple text layout: split by paragraphs, flow onto pages
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    if not paragraphs:
        paragraphs = [text]

    y = margin
    font_size = 11
    line_height = font_size * 1.5

    for para in paragraphs:
        pos = fitz.Point(margin, y)
        rc = page.insert_textbox(
            fitz.Rect(margin, y, margin + usable_w, margin + usable_h),
            para,
            fontsize=font_size,
            fontname="helv",
            align=fitz.TEXT_ALIGN_LEFT,
        )
        y = rc.y1 + line_height

        # If text overflows current page, start a new page
        if rc.y1 >= margin + usable_h - 20:
            page = doc.new_page(width=595, height=842)
            y = margin

    _ensure_dir(output_path)
    doc.save(output_path)
    doc.close()
    return f"Created PDF ({_get_page_count(fitz.open(output_path))} page(s)) → {output_path}"


# ── info ─────────────────────────────────────────────────────────────
def pdf_info(pdf_path: str) -> str:
    """Return metadata and page count for a PDF."""
    doc = fitz.open(pdf_path)
    meta = doc.metadata
    pages = _get_page_count(doc)
    doc.close()

    info_lines = [
        f"File: {pdf_path}",
        f"Pages: {pages}",
    ]
    if meta:
        for key in ("title", "author", "subject", "creator", "producer", "format"):
            val = meta.get(key)
            if val:
                info_lines.append(f"{key.capitalize()}: {val}")
    return "\n".join(info_lines)


# ── CLI ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="PDF Processing Skill")
    sub = parser.add_subparsers(dest="action", required=True)

    # convert-to-markdown
    p_md = sub.add_parser("convert-to-markdown", help="Convert PDF to structured Markdown")
    p_md.add_argument("--input", required=True, help="Source PDF path")
    p_md.add_argument("--output", required=True, help="Output .md path")

    # extract-text
    p_txt = sub.add_parser("extract-text", help="Extract all text from PDF")
    p_txt.add_argument("--input", required=True, help="Source PDF path")
    p_txt.add_argument("--output", required=True, help="Output .txt/.md path")
    p_txt.add_argument("--pages", default="", help="Page range, e.g. 1-3,5")

    # extract-tables
    p_tbl = sub.add_parser("extract-tables", help="Extract tables from PDF")
    p_tbl.add_argument("--input", required=True, help="Source PDF path")
    p_tbl.add_argument("--output", required=True, help="Output .csv/.json path")
    p_tbl.add_argument("--pages", default="", help="Page range, e.g. 1-3,5")

    # merge
    p_merge = sub.add_parser("merge", help="Merge multiple PDFs")
    p_merge.add_argument("--inputs", nargs="+", required=True, help="PDF files to merge (ordered)")
    p_merge.add_argument("--output", required=True, help="Output PDF path")

    # split
    p_split = sub.add_parser("split", help="Split PDF into pages")
    p_split.add_argument("--input", required=True, help="Source PDF path")
    p_split.add_argument("--output-dir", required=True, help="Output directory")
    p_split.add_argument("--pages-per-file", type=int, default=1, help="Pages per output file")

    # create
    p_create = sub.add_parser("create", help="Create PDF from text file")
    p_create.add_argument("--input", required=True, help="Source text file (.txt)")
    p_create.add_argument("--output", required=True, help="Output PDF path")

    # info
    p_info = sub.add_parser("info", help="Show PDF metadata")
    p_info.add_argument("--input", required=True, help="Source PDF path")

    args = parser.parse_args()

    try:
        if args.action == "convert-to-markdown":
            print(convert_to_markdown(args.input, args.output))
        elif args.action == "extract-text":
            print(extract_text(args.input, args.output, args.pages))
        elif args.action == "extract-tables":
            print(extract_tables(args.input, args.output, args.pages))
        elif args.action == "merge":
            print(merge_pdfs(args.inputs, args.output))
        elif args.action == "split":
            print(split_pdf(args.input, args.output_dir, args.pages_per_file))
        elif args.action == "create":
            print(create_pdf(args.input, args.output))
        elif args.action == "info":
            print(pdf_info(args.input))
    except Exception as e:
        print(f"Error: {e}")
