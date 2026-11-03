# -*- coding: utf-8 -*-
# QA visit phone alert (1 Nov 2026): guide 2.6 -> 2.7, manual 1.4 -> 1.5. Confirmed by the Executive Director for the Systems Owner (decision D20).
import docx, os
B = os.path.expanduser('~/LearnImpact_ED/KiuFunza Analysis/KF4_Endline_2026_Build/')
BUL = 'Phone alert: when a new QA visit has a serious item answered No, HQ team members who have phone alerts on get one alert, once per visit (not Advisors, not the field). It names the school and the number of items only, never a person or a score. Press the alert to open QA visits. Practice visits never alert.'
def add_after(doc, starts, text):
    for p in doc.paragraphs:
        if p.text.startswith(starts):
            par = doc.add_paragraph(text, style='List Bullet'); p._p.addnext(par._p); return True
    print('missing', starts); return False
def bump(doc, a, b):
    for p in doc.paragraphs:
        for r in p.runs:
            if a in r.text: r.text = r.text.replace(a, b)
g = B + 'KF4_Field_Command_Centre_User_Guide.docx'; d = docx.Document(g); add_after(d, 'The Bridge shows a line under Needs you now when a recent visit', BUL); bump(d, 'Version 2.6', 'Version 2.7'); d.save(g)
m = B + 'KF4_Field_Operations_Manual_INTERIM_v1.5.docx'; d = docx.Document(m); add_after(d, 'The Bridge shows a line under Needs you now when a recent visit', BUL); bump(d, 'Version 1.4', 'Version 1.5')
for t in d.tables:
    if t.rows and 'ersion' in t.rows[0].cells[0].text:
        c = t.add_row().cells
        for cell, v in zip(c, ['1.5', '1 Nov 2026', 'QA visits: phone alert to the HQ team when a new visit has a serious item answered No. Confirmed by the Executive Director for the Systems Owner.']): cell.text = v
d.save(m); os.rename(m, B + 'KF4_Field_Operations_Manual_INTERIM_v1.5.docx')
print('ok')
