# -*- coding: utf-8 -*-
# My day shows the school actually worked (4 Nov 2026): guide 3.4 -> 3.5, manual 2.2 -> 2.3. For Michael (ED) to confirm for the Systems Owner (decision D20).
import docx, os
B = os.path.expanduser('~/LearnImpact_ED/KiuFunza Analysis/KF4_Endline_2026_Build/')
ADD = ' If your records today are from a different school than the one planned for you, My day also shows that school with the words "You worked here today", and the planned school shows a short note. The count of pupils tested today uses the schools you really worked at. If the plan was wrong, tell your RC so the plan is changed.'
def bump(doc, a, b):
    for p in doc.paragraphs:
        for r in p.runs:
            if a in r.text: r.text = r.text.replace(a, b).replace('3 November 2026', '4 November 2026')
def append_myday(doc):
    ps = doc.paragraphs; i = [k for k, p in enumerate(ps) if p.style.name == 'Heading 2' and p.text == 'My day'][0]
    p = ps[i + 1]; assert p.text.startswith('Shows the schools planned'); p.runs[-1].text += ADD
g = B + 'KF4_Field_Command_Centre_User_Guide.docx'; d = docx.Document(g); append_myday(d); bump(d, 'Version 3.4', 'Version 3.5'); d.save(g)
m = B + 'KF4_Field_Operations_Manual_INTERIM_v2.2.docx'; d = docx.Document(m); append_myday(d); bump(d, 'Version 2.2', 'Version 2.3')
for t in d.tables:
    if t.rows and 'ersion' in t.rows[0].cells[0].text:
        c = t.add_row().cells
        for cell, v in zip(c, ['2.3', '4 Nov 2026', 'My day shows the school the person actually worked at today, not only the planned one. Pending confirmation by the Executive Director for the Systems Owner.']): cell.text = v
d.save(m); os.rename(m, B + 'KF4_Field_Operations_Manual_INTERIM_v2.3.docx')
print('ok')
