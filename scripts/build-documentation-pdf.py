#!/usr/bin/env python3
"""Build a downloadable PDF from the canonical Markdown documentation, without editing source files."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
from pathlib import Path
import re

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import SimpleDocTemplate, Paragraph, Preformatted, Spacer, KeepTogether, PageBreak
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parents[1]
DOCS = [
    "docs/README.md",
    "docs/ARQUITECTURA_ADMINISTRADOR_SAAS.md",
    "docs/MAPA_COMPONENTES_Y_RIESGOS.md",
    "docs/API_KEYS_INTEGRACIONES.md",
    "docs/TUVERSO_INTEGRACIONES.md",
    "docs/MOBILE_ORDER_AVAILABILITY_API.md",
    "docs/MOBILE_TUVERSO_APIS_SEPARADAS.md",
]
def fonts():
    regular = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    mono = Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")
    if regular.exists() and mono.exists():
        pdfmetrics.registerFont(TTFont("DocSans", str(regular)))
        pdfmetrics.registerFont(TTFont("DocMono", str(mono)))
        return "DocSans", "DocMono"
    return "Helvetica", "Courier"

def inline(text):
    # Preserve literal code characters; any formatting must be escaped.
    pieces = re.split(r"(`[^`]+`)", text)
    return "".join(
        f'<font color="#16588c">{escape(piece[1:-1])}</font>'
        if piece.startswith("`") and piece.endswith("`")
        else escape(piece).replace("**", "")
        for piece in pieces
    )

def convert(markdown, styles, mono):
    story = []
    code = []
    fenced = False
    def flush():
        if code:
            # Character wrapping prevents oversized API examples from clipping the page.
            for line in code:
                while len(line) > 90:
                    story.append(Preformatted(escape(line[:90]), styles["Code"]))
                    line = "  " + line[90:]
                story.append(Preformatted(escape(line or " "), styles["Code"]))
            story.append(Spacer(1, 3*mm))
            code.clear()
    for raw in markdown.splitlines():
        line = raw.rstrip()
        if line.lstrip().startswith("```"):
            if fenced:
                flush()
            fenced = not fenced
            continue
        if fenced:
            code.append(line)
            continue
        if not line.strip():
            story.append(Spacer(1, 2*mm))
            continue
        if line.startswith("# "):
            story.append(Paragraph(inline(line[2:]), styles["H1"]))
        elif line.startswith("## "):
            story.append(Paragraph(inline(line[3:]), styles["H2"]))
        elif line.startswith("### "):
            story.append(Paragraph(inline(line[4:]), styles["H3"]))
        elif line.startswith("|"):
            story.append(Paragraph(inline(line.replace("|","   |   ")), styles["Small"]))
        elif line.startswith("- ") or re.match(r"^\d+\. ", line):
            story.append(Paragraph("• " + inline(re.sub(r"^(?:- |\d+\. )", "", line)), styles["Body"]))
        else:
            story.append(Paragraph(inline(line), styles["Body"]))
    flush()
    return story

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--output", default="build/docs/Administrador_Web_Documentacion_Tecnica.pdf")
    args = p.parse_args()
    sans, mono = fonts()
    styles = {
        "Cover": ParagraphStyle("Cover",fontName=sans,fontSize=19,leading=26,textColor=colors.HexColor("#102c47"),spaceAfter=10*mm),
        "H1": ParagraphStyle("H1",fontName=sans,fontSize=15,leading=21,textColor=colors.HexColor("#102c47"),spaceBefore=7*mm,spaceAfter=4*mm),
        "H2": ParagraphStyle("H2",fontName=sans,fontSize=12,leading=18,textColor=colors.HexColor("#116181"),spaceBefore=5*mm,spaceAfter=2*mm),
        "H3": ParagraphStyle("H3",fontName=sans,fontSize=10,leading=15,textColor=colors.HexColor("#263d54"),spaceBefore=3*mm),
        "Body": ParagraphStyle("Body",fontName=sans,fontSize=8.3,leading=13,spaceAfter=2*mm,wordWrap="CJK"),
        "Small": ParagraphStyle("Small",fontName=sans,fontSize=7.4,leading=11,spaceAfter=1*mm,wordWrap="CJK"),
        "Code": ParagraphStyle("Code",fontName=mono,fontSize=7,leading=10,textColor=colors.HexColor("#244762")),
    }
    out = ROOT / args.output
    out.parent.mkdir(parents=True,exist_ok=True)
    document = SimpleDocTemplate(str(out),pagesize=(210*mm,297*mm),rightMargin=17*mm,leftMargin=17*mm,topMargin=19*mm,bottomMargin=19*mm,
                                 title="Administrador Web INTEGRA B2G - Documentación técnica",author="INTEGRA B2G")
    story = [Paragraph("Administrador Web — Documentación técnica",styles["Cover"]),
             Paragraph("Compilado automáticamente desde los archivos Markdown versionados del repositorio. Para modificar el contenido, editar los documentos fuente.",styles["Body"]),
             Paragraph(datetime.now(timezone.utc).strftime("Generado (UTC): %Y-%m-%d %H:%M"),styles["Small"])]
    for doc in DOCS:
        source = ROOT / doc
        if not source.is_file():
            raise FileNotFoundError(f"Missing canonical documentation: {doc}")
        story.extend([PageBreak(),Paragraph(escape(doc),styles["Small"])])
        story.extend(convert(source.read_text(encoding="utf-8"),styles,mono))
    def footer(canvas,doc):
        canvas.saveState()
        canvas.setFont(sans,7)
        canvas.setFillColor(colors.HexColor("#667788"))
        canvas.drawString(17*mm,11*mm,"INTEGRA B2G · Documento generado desde GitHub")
        canvas.drawRightString(193*mm,11*mm,str(doc.page))
        canvas.restoreState()
    document.build(story,onFirstPage=footer,onLaterPages=footer)
    print(f"PASS PDF generated: {out.relative_to(ROOT)} ({out.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
