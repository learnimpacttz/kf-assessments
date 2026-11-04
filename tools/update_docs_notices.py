# -*- coding: utf-8 -*-
# Late notices go red for coordinators and HQ; submissions check uses the 10 Nov field target; long News messages stay whole (4 Nov 2026).
# Guide 3.5 -> 3.6, manual 2.3 -> 2.4. For Michael (ED) to confirm for the Systems Owner (decision D20).
import docx, os
B = os.path.expanduser('~/LearnImpact_ED/KiuFunza Analysis/KF4_Endline_2026_Build/')
ADD = ' Late notices are shown in red: when a notice to a ward officer (5 working days before) or to a head teacher (3 working days before) has not been marked sent by its day, the RC and ARC of that region see "N notices are late" in the box, and HQ sees it as urgent on the Bridge. Send the notice, mark it sent in Plan & calendar, and the red goes away.'
SUB = ' The Bridge also checks KoBo submissions: it adds up the submissions so far plus the usual daily number until 10 November, the target for finishing field work, and compares the total with the aim of 20,000 and with the plan limit. It raises an alert only when the total would go above the aim. The dates after field work do not change.'
def bump(doc, a, b):
    for p in doc.paragraphs:
        for r in p.runs:
            if a in r.text: r.text = r.text.replace(a, b).replace('4 November 2026', '5 November 2026') if False else r.text.replace(a, b)
def add_action_box(doc):
    for p in doc.paragraphs:
        if p.text.startswith('The action box.'): p.runs[-1].text += ADD + SUB; return True
    print('missing action box'); return False
g = B + 'KF4_Field_Command_Centre_User_Guide.docx'; d = docx.Document(g); add_action_box(d); bump(d, 'Version 3.5', 'Version 3.6'); d.save(g)
m = B + 'KF4_Field_Operations_Manual_INTERIM_v2.3.docx'; d = docx.Document(m); add_action_box(d); bump(d, 'Version 2.3', 'Version 2.4')
for t in d.tables:
    if t.rows and 'ersion' in t.rows[0].cells[0].text:
        c = t.add_row().cells
        for cell, v in zip(c, ['2.4', '4 Nov 2026', 'Late notices shown in red for coordinators and HQ; the KoBo submissions check looks to 10 Nov (field target) against the 20,000 aim; long News messages are kept whole. Pending confirmation by the Executive Director for the Systems Owner.']): cell.text = v
d.save(m); os.rename(m, B + 'KF4_Field_Operations_Manual_INTERIM_v2.4.docx')
print('ok')
