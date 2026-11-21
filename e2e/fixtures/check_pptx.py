"""Tarkistaa .pptx-tiedoston python-pptx:llä ja tulostaa yhteenvedon JSONina."""
import json
import sys

from pptx import Presentation

prs = Presentation(sys.argv[1])
slides = []
for s in prs.slides:
    pics = [sh for sh in s.shapes if sh.shape_type == 13]
    texts = [sh.text_frame.text for sh in s.shapes if sh.has_text_frame and sh.text_frame.text]
    tables = [sh for sh in s.shapes if sh.has_table]
    notes = s.notes_slide.notes_text_frame.text if s.has_notes_slide else ""
    slides.append(
        {
            "pictures": len(pics),
            "pic_sizes": [(p.width, p.height) for p in pics],
            "texts": texts,
            "tables": [[[c.text for c in r.cells] for r in t.table.rows] for t in tables],
            "notes": notes,
        }
    )
print(json.dumps({"count": len(slides), "width": prs.slide_width, "height": prs.slide_height, "slides": slides}))
