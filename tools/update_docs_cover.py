# -*- coding: utf-8 -*-
# Coordinator coverage (3 Nov 2026): guide 2.7 -> 2.8, manual 1.5 -> 1.6, quick start. Confirmed by the Executive Director for the Systems Owner (decision D20).
import docx, os
B = os.path.expanduser('~/LearnImpact_ED/KiuFunza Analysis/KF4_Endline_2026_Build/')
RULES = 'Every school visit must have an RC or ARC present. If neither can be there, an acting coordinator is named from the team\'s volunteers and told. When both coordinators are at one school, the RC leads. The same person can visit more than one school in a day, but only at different times (at least an hour apart).'
COORD = [('h2', 'Confirm days (coordinators)'),
 ('p', 'Why this page: the plan could show one coordinator for several schools on one day, and nothing asked the coordinators to confirm who was at which school. That was a gap in the system, and it also went unnoticed by the teams. ' + RULES),
 ('b', 'Each working day, open Confirm days. For each school on the next working day, choose who is the coordinator at that school (the RC, the ARC, or a volunteer from that school\'s team acting for you), then press Save assignments and confirm. Do this by 18:00 the day before. You get a phone alert at 14:30, a reminder at 16:30 and, if still open, one at 07:05 on the day.'),
 ('b', 'If you will not be there, open I will not be there, say why (sick leave, approved leave, other duty or other, with a short note and never medical details) and name the acting coordinator for each school you would have led. The volunteer you name gets a phone alert and a note on My day.'),
 ('b', 'Leave: report your own leave under Leave on the same page. HQ approves it. The system then asks for an acting coordinator on those days.'),
 ('b', 'Days gone: when the plan and the records differ on a past day (for example a school where no RC or ARC appears in the records), your region gets one item for the day. Say what happened: the records are right and the plan was out of date, a coordinator was on leave, or something else (with a note), and name who acted as coordinator at any school that had none. HQ then acknowledges. It is a prompt to confirm, not a judgment.'),
 ('b', 'Moving a visit in Plan and calendar no longer lets you put the same person at two schools starting within an hour of each other (use different start times), and when both coordinators are in one team the RC leads.')]
HQ = [('h2', 'Coverage (Field)'),
 ('p', 'Coverage shows every region for the next working day: whether each coordinator has confirmed, schools with no coordinator named, days waiting for the region\'s answer and answers to read. ' + RULES),
 ('b', 'Open a region to see the days ahead and the days gone, and to name or change the acting coordinator (HQ Editors and Admins). HQ records or approves leave for any coordinator: write the name and date of the approving email in Approved by, and never write medical details.'),
 ('b', 'Acknowledge a region\'s answer for a past day after reading it. The Bridge shows a line when coordinators have not confirmed by 18:00, when schools have no coordinator named, and when days still wait for an answer.'),
 ('b', 'Phone alerts go to the individual coordinator concerned and to a volunteer named as acting coordinator; HQ is told through the Bridge. Coverage changes no test record, query or payment.')]
VOL = ('b', 'If your coordinator names you as acting coordinator, you get a phone alert and a note at the top of My day. Lead the visit as the RC or ARC would: welcome the head teacher, hold the opening meeting, check the register and the random numbers.')
def insert(doc, heading, items):
    ps = doc.paragraphs; idx = [i for i, p in enumerate(ps) if p.style.name == 'Heading 1' and p.text.startswith(heading)]
    if not idx: print('missing', heading); return
    nxt = next((p for p in ps[idx[0] + 1:] if p.style.name == 'Heading 1'), None)
    for k, t in items:
        par = doc.add_paragraph(t, style={'h2': 'Heading 2', 'p': 'Normal', 'b': 'List Bullet'}[k])
        if nxt is not None: nxt._p.addprevious(par._p)
def bump(doc, a, b):
    for p in doc.paragraphs:
        for r in p.runs:
            if a in r.text: r.text = r.text.replace(a, b).replace('1 November 2026', '3 November 2026')
g = B + 'KF4_Field_Command_Centre_User_Guide.docx'; d = docx.Document(g)
insert(d, '3. For test admins', [VOL]); insert(d, '4. For regional and assistant coordinators', COORD); insert(d, '5. For HQ', HQ); bump(d, 'Version 2.7', 'Version 2.8'); d.save(g)
m = B + 'KF4_Field_Operations_Manual_INTERIM_v1.5.docx'; d = docx.Document(m)
insert(d, '3. For test admins', [VOL]); insert(d, '4. For regional and assistant coordinators', COORD); insert(d, '5. For HQ', HQ); bump(d, 'Version 1.5', 'Version 1.6')
for t in d.tables:
    if t.rows and 'ersion' in t.rows[0].cells[0].text:
        c = t.add_row().cells
        for cell, v in zip(c, ['1.6', '3 Nov 2026', 'Coordinator coverage: every school visit has an RC or ARC or a named acting coordinator; daily confirmation, leave, past-day confirmations and phone alerts. Confirmed by the Executive Director for the Systems Owner.']): cell.text = v
d.save(m); os.rename(m, B + 'KF4_Field_Operations_Manual_INTERIM_v1.6.docx')
q = B + 'KF4_LI-CC_Quick_Start.docx'; d = docx.Document(q); ps = d.paragraphs
def add_after(starts, text):
    for p in d.paragraphs:
        if p.text.startswith(starts): par = d.add_paragraph(text, style='List Bullet'); p._p.addnext(par._p); return
    print('missing', starts)
add_after('Region: read the prompt', 'Confirm days: every working day by 18:00, say who is the coordinator at each school tomorrow (RC, ARC or an acting volunteer) and confirm. Away? Say so and name who acts.')
add_after('HQ desk (left sidebar)', 'Coverage (under Field): who has confirmed tomorrow, schools with no coordinator named, leave, and answers to acknowledge.')
d.save(q); print('ok')
