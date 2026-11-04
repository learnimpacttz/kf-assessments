# -*- coding: utf-8 -*-
# Late-notice phone alert, plan window and coverage rules to 13 Nov; wording of 2.3-2.5 confirmed (4 Nov 2026). Guide 3.7 -> 3.8, manual 2.5 -> 2.6.
import docx, os
B = os.path.expanduser('~/LearnImpact_ED/KiuFunza Analysis/KF4_Endline_2026_Build/')
ADD = ' Late notices also send one phone alert each working morning (about 7:05) to the RC and ARC of the region, until the notices are marked sent. Plans, day confirmations and the coverage checks run until schools close on 13 November.'
CONF = 'Confirmed by the Executive Director for the Systems Owner (decision D20), 4 Nov 2026.'
def add_action_box(doc):
    for p in doc.paragraphs:
        if p.text.startswith('The action box.'): p.runs[-1].text += ADD; return True
    print('missing')
def bump(doc, a, b):
    for p in doc.paragraphs:
        for r in p.runs:
            if a in r.text: r.text = r.text.replace(a, b)
g = B + 'KF4_Field_Command_Centre_User_Guide.docx'; d = docx.Document(g); add_action_box(d); bump(d, 'Version 3.7', 'Version 3.8'); d.save(g)
m = B + 'KF4_Field_Operations_Manual_INTERIM_v2.5.docx'; d = docx.Document(m); add_action_box(d); bump(d, 'Version 2.5', 'Version 2.6')
bump(d, 'Draft for review by Mundo and Joram, then for the field team', 'Reviewed by the Executive Director for the Systems Owner; for Mundo, Joram and the field team')
for t in d.tables:
    if t.rows and 'ersion' in t.rows[0].cells[0].text:
        for row in t.rows:
            c = row.cells[-1]
            if 'Pending confirmation by the Executive Director for the Systems Owner.' in c.text: c.text = c.text.replace('Pending confirmation by the Executive Director for the Systems Owner.', CONF)
        c = t.add_row().cells
        for cell, v in zip(c, ['2.6', '4 Nov 2026', 'Phone alert for late notices (every working morning to the RC and ARC); plans and coverage rules end when schools close on 13 Nov. ' + CONF]): cell.text = v
d.save(m); os.rename(m, B + 'KF4_Field_Operations_Manual_INTERIM_v2.6.docx'); print('ok')
