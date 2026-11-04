# -*- coding: utf-8 -*-
# School visits are judged by 10 Nov, schools close 13 Nov; cleaning/payments/reports keep their own dates; "Coming up" wording (4 Nov 2026).
# Guide 3.6 -> 3.7, manual 2.4 -> 2.5. For Michael (ED) to confirm for the Systems Owner (decision D20).
import docx, os
B = os.path.expanduser('~/LearnImpact_ED/KiuFunza Analysis/KF4_Endline_2026_Build/')
R = [
 ('The chance of finishing by 4 December and a likely date range.', 'The chance of finishing the school visits by 10 November (the target) and before schools close on 13 November, and a likely date range.'),
 ('and the chance of finishing by 4 December. It simulates', 'and the chance of finishing the school visits by 10 November and before schools close on 13 November. It simulates'),
 ('Dates: field work closes 4 Dec, cleaning 25 Nov,', 'Dates: school visits finish by 10 Nov (the target) and schools close 13 Nov, so no school can be visited after that. Cleaning 25 Nov,'),
 ('Field work closes after the cleaning deadline, so the Bridge warns that records sent after 25 Nov need a final sweep.', 'School visits and the other work are judged separately: the pace and the forecast look at school visits only, and cleaning, payments and reports keep their own dates.'),
 ('(19 October to 4 December)', '(19 October until schools close on 13 November)'),
]
def fix(doc):
    n = 0
    for p in doc.paragraphs:
        for r in p.runs:
            for a, b in R:
                if a in r.text: r.text = r.text.replace(a, b); n += 1
    return n
def bump(doc, a, b):
    for p in doc.paragraphs:
        for r in p.runs:
            if a in r.text: r.text = r.text.replace(a, b)
g = B + 'KF4_Field_Command_Centre_User_Guide.docx'; d = docx.Document(g); print('guide', fix(d)); bump(d, 'Version 3.6', 'Version 3.7'); d.save(g)
m = B + 'KF4_Field_Operations_Manual_INTERIM_v2.4.docx'; d = docx.Document(m); print('manual', fix(d)); bump(d, 'Version 2.4', 'Version 2.5')
for t in d.tables:
    if t.rows and 'ersion' in t.rows[0].cells[0].text:
        c = t.add_row().cells
        for cell, v in zip(c, ['2.5', '4 Nov 2026', 'School visits are judged by 10 Nov and schools close 13 Nov; cleaning, payments and reports keep their dates; clearer "Coming up" note on My day. Pending confirmation by the Executive Director for the Systems Owner.']): cell.text = v
d.save(m); os.rename(m, B + 'KF4_Field_Operations_Manual_INTERIM_v2.5.docx')
