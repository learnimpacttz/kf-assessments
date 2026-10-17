#!/usr/bin/env python3
"""Checks the LIVE system: who can and cannot reach what. Reads the HQ code from the restricted staff folder (never printed),
fetches a volunteer, an RC and an ARC code from the admin list, then tries sensitive endpoints with each. Exit code 1 if any gate is open."""
import json, os, subprocess, sys
B = 'https://kf-assessments.learnimpacttz.workers.dev'
R = os.path.expanduser('~/LearnImpact_ED/KiuFunza Analysis/KF4_Endline_2026_Build/04_Staff_Roster_RESTRICTED/HQ_ACCESS_CODE.txt')
hq = open(R).read().split('\n')[0].split()[-1]
def call(path, code=None, method='GET', body=None):
    cmd = ['curl', '-s', '-m', '60', '-o', '/tmp/_lac', '-w', '%{http_code}', '-X', method, B + path]
    if code: cmd += ['-H', 'x-access-code: ' + code]
    if body is not None: cmd += ['-H', 'content-type: application/json', '--data', json.dumps(body)]
    return int(subprocess.run(cmd, capture_output=True, text=True).stdout.strip() or 0)
call('/api/admin/codes', hq); codes = json.load(open('/tmp/_lac'))['codes']
pick = lambda pos: next(c['code'] for c in codes if c['position'].startswith(pos))
who = {'none': None, 'volunteer': pick('Volunteer'), 'rc': pick('RC'), 'arc': pick('ARC')}
bad = 0
admin_get = ['/api/admin/status', '/api/admin/codes', '/api/admin/roster', '/api/admin/settings', '/api/admin/guests', '/api/admin/activity', '/api/admin/hq-users', '/api/usage/report', '/api/corrections']
admin_post = [('/api/admin/push-field', {'kind': 'finalize'}), ('/api/admin/guests', {'action': 'create'}), ('/api/layouts', {'role': 'hq'}), ('/api/admin/roster', {'action': 'remove', 'id': 1}), ('/api/admin/recompute', {})]
for k, c in who.items():
    for p in admin_get:
        s = call(p, c)
        if s not in (401, 403): print('OPEN GATE', k, 'GET', p, s); bad += 1
    for p, b in admin_post:
        s = call(p, c, 'POST', b)
        if s not in (401, 403): print('OPEN GATE', k, 'POST', p, s); bad += 1
for k in ('volunteer', 'rc', 'arc'):
    if call('/api/plan?region=KIGOMA' if k != 'rc' or True else '', who[k]) not in (200, 403): print('unexpected plan status', k)
print('gates checked, open gates:', bad); sys.exit(1 if bad else 0)
