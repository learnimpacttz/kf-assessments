# -*- coding: utf-8 -*-
# QA visits (1 Nov 2026): guide 2.5 -> 2.6, manual 1.3 -> 1.4, HQ quick start. Draft for confirmation until the Systems Owner confirms.
import docx, os
B = os.path.expanduser('~/LearnImpact_ED/KiuFunza Analysis/KF4_Endline_2026_Build/')
CHECK = [('b', 'QA visit finding: an HQ observer watched a visit and noted items to follow up. It arrives like any other query for the person the visit was about, with a short list of the items. Write what happened and what was done, or what will change next time. It is meant to support the team and is answered and reviewed in the usual way. It does not show a score.')]
HQ = [
 ('h2', 'QA visits (Checks)'),
 ('p', 'QA visits shows what the HQ observers found when they watched a test administrator at a school. The observer fills in the Quality Assurance form on KoBo with their own KoBo login (the button Open the QA form on the page). The visit appears here within a minute, the page updates itself while it is open, and new visits carry a New tag. Each visit is scored as the share of checklist items answered Yes (Not applicable is left out).'),
 ('b', 'Serious items: a No on any of these is marked Serious and counted separately: the consent form was signed (C2); present pupils were numbered without gaps (G1); the number of present pupils entered matches the register (G2); the app drew the random numbers (G3); the selected pupils were identified by matching the numbers to the register (G5); they were called by name from the register (G6); the grade chosen matches what the pupil answered (I3); the app\'s move-on rule was followed (I4).'),
 ('b', 'Checks against our records: for each visit the page compares the QA form with the plan for that school and day, the school location, the tests and sampling the team entered that day, the attendance the team entered against the register count the observer saw, and the pupil number the observer wrote against the test records. A comparison that does not match is a prompt to look, not a conclusion; records may not have arrived yet. Only the distance of the QA form from the school is kept, never the location.'),
 ('b', 'HQ report: a card on the page writes a plain summary for today, the last 7 days or all visits, with a Copy button. Nothing is sent anywhere by itself.'),
 ('b', 'Send to team as query: HQ Editors and Admins can send a finding to the person the visit was about. It becomes a check called QA visit finding, answered and reviewed through the normal chain (the person, team review, first HQ review, final approval). Nothing else is sent and no score is shown to the team. A finding can be sent once.'),
 ('b', 'The Bridge shows a line under Needs you now when a recent visit has a serious item answered No. A visit whose comment starts with TEST is shown as Practice and is not counted.'),
 ('b', 'Who sees it: the HQ team, except Advisors. Field staff and partners do not see the page. Each opening is recorded in the activity log. No pupil names are ever recorded; the observer writes only the pupil number from the random selection list.'),
]
QS = ('b', 'QA visits (Checks): what the HQ observers found at schools, scored and checked against the plan and the records. The visit appears within a minute. Open the QA form to start a visit; HQ report summarizes the period; Send to team as query is the only way a finding reaches the field, and only HQ decides.')
def insert(doc, heading, items):
    ps = doc.paragraphs
    idx = [i for i, p in enumerate(ps) if p.style.name == 'Heading 1' and p.text.startswith(heading)]
    if not idx: print('missing', heading); return
    nxt = next((p for p in ps[idx[0] + 1:] if p.style.name == 'Heading 1'), None)
    for k, t in items:
        par = doc.add_paragraph(t, style={'h2': 'Heading 2', 'p': 'Normal', 'b': 'List Bullet'}[k])
        if nxt is not None: nxt._p.addprevious(par._p)
def bump(doc, a, b):
    for p in doc.paragraphs:
        if a in p.text:
            for r in p.runs: r.text = r.text.replace(a, b).replace('27 October 2026', '1 November 2026')
g = B + 'KF4_Field_Command_Centre_User_Guide.docx'; d = docx.Document(g)
insert(d, '5. For HQ', HQ); insert(d, '8. The checks, in plain words', CHECK); bump(d, 'Version 2.5', 'Version 2.6 (draft for confirmation)'); d.save(g)
m = B + 'KF4_Field_Operations_Manual_INTERIM_v1.3.docx'; d = docx.Document(m)
insert(d, '5. For HQ', HQ); insert(d, '8. The checks, in plain words', CHECK); bump(d, 'Version 1.3', 'Version 1.4')
for t in d.tables:
    if t.rows and 'ersion' in t.rows[0].cells[0].text:
        c = t.add_row().cells
        for cell, v in zip(c, ['1.4', '1 Nov 2026', 'QA visits: HQ observers\' Quality Assurance form read into the Command Center (HQ only), scored and checked against plans and records; HQ report; Send to team as query. Draft for confirmation.']): cell.text = v
d.save(m); os.rename(m, B + 'KF4_Field_Operations_Manual_INTERIM_v1.4.docx')
q = B + 'KF4_LI-CC_Quick_Start.docx'; d = docx.Document(q)
tools = [i for i, p in enumerate(d.paragraphs) if p.text.strip() == 'Tools']
if tools:
    ps = d.paragraphs; last = tools[-1]; j = last + 1
    while j + 1 < len(ps) and ps[j + 1].style.name == 'List Bullet': j += 1
    par = d.add_paragraph(QS[1], style='List Bullet'); ps[j]._p.addnext(par._p)
d.save(q)
print('ok')
