# -*- coding: utf-8 -*-
import docx, re, copy, os, shutil
from docx.shared import Pt
B=os.path.expanduser('~/LearnImpact_ED/KiuFunza Analysis/KF4_Endline_2026_Build/')
SPELL=[(r'Field Command Centre','LI Command Center'),(r'Command Centre','Command Center'),(r'\bProgramme','Program'),(r'\bprogramme','program'),(r'\bpractise','practice'),(r'\bPractise','Practice'),(r'\brecognised','recognized'),(r'\bcolour','color'),(r'\bColour','Color'),(r'\bfinalis','finaliz'),(r'\bcentre','center'),(r'\bCentre','Center'),(r'\benrolment','enrollment'),(r'\bgrey\b','gray'),(r'\bbehaviour','behavior'),(r'\bsummaris','summariz')]
def respell(doc):
    def fix(p):
        for r in p.runs:
            t=r.text
            for a,b in SPELL: t=re.sub(a,b,t)
            if t!=r.text: r.text=t
    for p in doc.paragraphs: fix(p)
    for t in doc.tables:
        for row in t.rows:
            for c in row.cells:
                for p in c.paragraphs: fix(p)
S2=[('h2','Choose your language and look'),
('b','Open the account menu (your initials, top right). Under Lugha · Language choose Kiswahili or English. Kiswahili covers the pages for test admins.'),
('b','Under Appearance choose light, dark or automatic (it follows your phone).'),
('h2','Messages for you'),
('p','A message from HQ or your coordinator shows at the top of News and as a banner, and you get a phone alert. Press Got it so the sender knows you read it.')]
S3=[('h2','Ask a question'),
('n','Open Ask a question (under Today).'),('n','Choose what it is about, and the school if it is about one.'),('n','Write the question in a sentence or two. Tick urgent only if it blocks your work today.'),('n','Press Send. Your coordinator answers first and sends it to HQ if needed. You get an alert when there is an answer.'),('n','If it is not solved, press Ask again. If it is, press That solved it.'),
('h2','Queries prompt on My day'),
('p','When you have a query to answer, My day shows "Queries: N to answer" with an Open My queries button. You answer first; your RC or ARC then reviews it. If your coordinator reminds you, answer the same day.')]
S4=[('h2','Queries about volunteers'),
('b','If a query is about a volunteer, the volunteer answers first. You cannot answer for them. Use Remind (one reminder per query every 4 hours), then review the reply: approve, edit and approve, or send back.'),
('b','Queries waiting for you carry an "I review" tag; queries you must answer carry "I respond". The filter "I review or respond" shows them. Your Region page starts with a prompt that counts them.'),
('b','When a query is approved everyone who took part gets an alert, and the whole journey stays visible in its history.'),
('h2','Questions and messages from your team'),
('b','Volunteers\' questions arrive under Questions. Answer, send to HQ, or close. Aim to answer within one working day.'),
('b','To send a short message to a person, a school team or your region, click the name or school and use Send a message. They get a phone alert; you can see who has read it.'),
('h2','School reports'),
('p','After each visit open School reports, choose the school and answer the guiding questions in Kiswahili or English, then press Mark complete. At the end the system compiles every school, with its numbers, into one report. RCs and ARCs of both regions at a pilot school can write for it.'),
('h2','Reports for you and for the district'),
('p','The Reports page offers only what matters to a region: school progress, notices and plan compliance, the daily summary, queries and replies, and a Summary for the district (local government) with no staff names or query details.'),
('h2','Asking for a correction or a deletion'),
('b','Open Data cleaning. Choose Delete records or Edit records, find the records, tick them and say why.'),
('b','Edits change labels only: school, grade, test administrator, district, region or pupil number. Answers and times are never touched. A grade edit changes the grade label and the pupil ID only.'),
('b','The request goes to Joram (first HQ review), then Mundo (final approval, who applies it). A full copy of the originals is saved first.'),
('b','Never fix a record in the KoBo web editor: the forms break on stored answers.'),
('h2','Assigned versus who did the work'),
('p','Credit always goes to the name on the record. The dashboard compares it with the plan. A person who sent records at a different school than planned raises a query: confirm it and say what happened. A helper who was not on the plan, someone who tested another grade, or a planned volunteer who sent nothing is shown as information only, under "For information" on Queries.')]
S5=[('h2','The HQ desk'),
('p','On a computer HQ works from a left sidebar: Today, Field operations, Data quality, People, Communication, Reports and System. Field pages such as My day are not part of it; use View as to see them.'),
('h2','Messages, questions and notes'),
('b','Send a message: open a person, school or region and use Send a message. The person or team gets a phone alert and sees it under News. Messages > Direct messages shows who has read each one.'),
('b','Questions: field staff and coordinators ask under Questions (a volunteer\'s RC or ARC answers first). Answering sends the asker an alert. Urgent ones sort first.'),
('b','HQ notes: private notes on any person, school, region, query or data-cleaning request. Tag a colleague to alert them. Field staff never see them. The author or an Admin can delete.'),
('h2','Usage & analytics'),
('p','Under System. Shows who opens the app, which pages, at what hour, on which device, and who has phone alerts on. Counting of page views started on 17 October; earlier days come from saved actions (plans, replies, reviews). It lists people who are not using the app and gives plain suggestions.'),
('h2','Layouts and Arrange this page'),
('b','Admin > Layouts: choose which pages each group sees and in what order (HQ, coordinators, volunteers, public visitors, and each guest profile). HQ cannot hide its own Admin or Today pages.'),
('b','Account menu > Arrange this page: move cards up or down or hide them for a group. Use View as first to arrange another group\'s page. Hiding a card only changes what is shown, not what the person may see.'),
('h2','Guests (invited viewers)'),
('b','Admin > People & access > Guests: invite a Board member, Collaborator, Funder, Government or Partner contact. They receive an emailed code and a link.'),
('b','Invitations can end after 30, 90 days, 6 months or a year, or never. You can extend, resend, issue a new code or revoke at any time.'),
('b','Guests see the public pages only, and the Reports page with ready-made, aggregate reports. They can download only if you allow it for that guest. Screenshots cannot be fully blocked, so share only aggregate figures.'),
('b','A partner logo can be shown, with "Powered by LearnImpact Command Center" in the footer.'),
('h2','The query chain and corrections'),
('b','Order: the person answers, the team (RC or ARC) reviews, Joram does the first HQ review, Mundo gives the final approval. Nobody closes a query outside the chain, including Joram and Mundo.'),
('b','Deletion and edit requests follow the same chain: suggested, Joram initiates, Mundo applies. Moving records to the right school uses the correction tool: find, preview, approve, apply. The originals are saved and every record is read back and checked.'),
('h2','Admin: six sub-pages'),
('p','Health, People & access, Messages, KoBo & forms, Data safety, Layouts and Settings. Each opens only its own cards. The page you used last is remembered.'),
('h2','Backups and recovery'),
('b','Every night a backup is stored inside Cloudflare, encrypted. On Sundays a full copy is made, and on Mondays at 07:00 it is emailed.'),
('b','It now includes guests, layouts, narratives, pilot placements, notes, questions, messages and the saved originals of deleted or corrected records.'),
('b','To open a backup file use tools/decrypt_backup.mjs with the passphrase (kept in the restricted staff folder and the password manager). Restoring is done by an Admin together with Michael.'),
('b','Once a month save a downloaded backup to LearnImpact\'s own storage as an off-site copy. The code is also backed up on GitHub (learnimpacttz).')]
S6=[('h2','Invited guests'),('p','Board members, collaborators, funders, government and partners can be invited with a personal code. They see aggregate progress and ready-made reports only, view only, with the partner logo if one is set.')]
S7=[('h2','Other alerts'),('b','Direct messages from HQ or your coordinator come as a phone alert and wait for you under News until you press Got it.'),('b','HQ can send a one-off reminder to all field staff, for example to finalize every assessment and never reopen a sent record.')]
def insert_before(doc, h1_prefix, blocks, anchor_next=None):
    paras=doc.paragraphs
    idx=[i for i,p in enumerate(paras) if p.style.name=='Heading 1' and p.text.startswith(h1_prefix)]
    if not idx: print('missing',h1_prefix); return
    nxt=None
    for p in paras[idx[0]+1:]:
        if p.style.name=='Heading 1': nxt=p; break
    num=0
    for kind,text in blocks:
        if kind=='n': num+=1; text=f'{num}. {text}'
        else: num=0
        st={'h2':'Heading 2','p':'Normal','b':'List Bullet','n':'Normal'}[kind]
        par=doc.add_paragraph(text,style=st)
        if nxt is not None: nxt._p.addprevious(par._p)
def addsec(doc):
    insert_before(doc,'2. Getting started',S2); insert_before(doc,'3. For test admins',S3); insert_before(doc,'4. For regional',S4); insert_before(doc,'5. For HQ',S5); insert_before(doc,'6. For partners',S6); insert_before(doc,'7. Emails and alerts',S7)
# user guide
src=B+'KF4_Field_Command_Centre_User_Guide.docx'; pass
g=docx.Document(src); addsec(g)
for p in g.paragraphs:
    if 'Version 1.3' in p.text:
        for r in p.runs: r.text=r.text.replace('Version 1.3','Version 1.4').replace('10 October 2026','17 October 2026')
respell(g); g.save(src)
# manual
m=B+'KF4_Field_Operations_Manual_INTERIM_v0.1.docx'; pass
d=docx.Document(m)
# Part C sections live between "Part C" and "Part D": run insertion but constrain to Part C by anchors (headings unique in manual)
addsec(d)
# Part F bullets: before "Deleting data"
for i,p in enumerate(d.paragraphs):
    if p.style.name=='Heading 2' and p.text.startswith('Deleting data'):
        for t in ['Encrypted backups: every backup is now encrypted. The passphrase is kept in the restricted staff folder and the password manager. tools/decrypt_backup.mjs opens a backup file.','Backups now include guests, layouts, narratives, pilot placements, notes, questions, messages and the saved originals of deleted or corrected records.','Off-site copy: once a month an Admin saves a downloaded backup to LearnImpact\'s own storage. The code is backed up on GitHub (learnimpacttz).','Code and tests: sh test/run_all.sh runs the automated tests; python3 test/live_access_check.py checks the live system\'s access gates. Hand-over notes for Mundo are in the repo (docs/).']:
            par=d.add_paragraph(t,style='List Bullet'); p._p.addprevious(par._p)
        break
# change log row
tbl=d.tables[24]; row=tbl.add_row().cells
vals=['0.2','17 Oct 2026','Command Center name and American spelling; HQ desk, layouts, guests; assignments vs who did the work; query chain rules (volunteer answers first, Joram and Mundo follow the chain); edits and corrections; school narratives; direct messages, questions to HQ and HQ notes; Kiswahili for test-admin pages; usage analytics; encrypted backups and hand-over notes.']
for c,v in zip(row,vals): c.text=v
for p in d.paragraphs:
    if p.text.startswith('Version 0.1'):
        for r in p.runs: r.text=r.text.replace('Version 0.1','Version 0.2').replace('10 October 2026','17 October 2026')
respell(d); d.save(m)
print('saved')
