// Aggregation only — never touch or store: enumerator name, GPS/geolocation,
// the `arm` field (RCT treatment assignment), student age/gender, or any
// raw item-response field.
//
// Scoring methodology confirmed against both the KF4_Students_Tool_2025
// XLSForm's `calculate` fields and the Stata bonus-payment code that
// consumes the same outputs (2026-08-05): there is no 1-4 "level" —
// KiuFunza is skill-based. Each of 8 skills per grade (4 reading + 4
// arithmetic) is independently pass/fail: >=3 of 5 items correct, or
// >=30 of 50 words for the reading-speed skill. The raw data already
// contains these as precomputed 0/1 flags (the *_g_* fields below) —
// no need to re-derive from item-level responses ourselves.

export const SKILLS_BY_GRADE = {
  1: {
    reading: [
      ['k1_g_letters', 'Letter Sounds'],
      ['k1_g_syllables', 'Syllables'],
      ['k1_g_words', 'Words'],
      ['k1_g_sentences', 'Sentences'],
    ],
    arithmetic: [
      ['a1_g_nr_recog', 'Number Recognition'],
      ['a1_g_nr_compare', 'Number Comparison'],
      ['a1_g_addition', 'Addition'],
      ['a1_g_subtr', 'Subtraction'],
    ],
  },
  2: {
    reading: [
      ['k2_g_words', 'Words'],
      ['k2_g_sentences', 'Sentences'],
      ['k2_g_readspeed', 'Reading Speed'],
      ['k2_g_read_compr', 'Reading Comprehension'],
    ],
    arithmetic: [
      ['a2_g_nr_compare', 'Number Comparison'],
      ['a2_g_nr_miss', 'Missing Number'],
      ['a2_g_addition', 'Addition'],
      ['a2_g_subtr', 'Subtraction'],
    ],
  },
  3: {
    reading: [
      ['k3_g_dict', 'Dictation'],
      ['k3_g_words_mean', 'Word Meaning'],
      ['k3_g_readspeed', 'Reading Speed'],
      ['k3_g_read_compr', 'Reading Comprehension'],
    ],
    arithmetic: [
      ['a3_g_nr_miss', 'Missing Number'],
      ['a3_g_addition', 'Addition'],
      ['a3_g_subtr', 'Subtraction'],
      ['a3_g_multiply', 'Multiplication'],
    ],
  },
};

function bump(obj, key) {
  if (!key) return;
  obj[key] = (obj[key] || 0) + 1;
}

function emptySkillBucket() {
  const bucket = {};
  for (const grade of Object.keys(SKILLS_BY_GRADE)) {
    bucket[grade] = { reading: {}, arithmetic: {} };
    for (const domain of ['reading', 'arithmetic']) {
      for (const [, label] of SKILLS_BY_GRADE[grade][domain]) {
        bucket[grade][domain][label] = { passed: 0, attempted: 0 };
      }
    }
  }
  return bucket;
}

export function emptyCounts() {
  return {
    total_records: 0,
    // PUBLIC tier — safe for anyone, no PII, no performance results.
    by_year: {},
    by_grade: {},
    by_region: {},
    submissions_by_date: {},
    // TEAM tier (access-gated) — operational/progress detail. Enumerator
    // name is PII, so this whole section must never reach the public tier.
    by_enumerator: {},
    by_school: {}, // { "SCHOOL_CODE": { name, count, by_grade: {1:n,2:n,3:n} } }
    dq_flags: {
      missing_enumerator: 0,
      missing_school: 0,
      missing_grade: 0,
      submitted_but_no_skill_data: 0, // record exists but none of that grade's 8 skill fields were filled — likely an incomplete/broken submission worth a field-team follow-up
    },
    // HQ tier (stricter access-gated) — the actual assessment results.
    skills: emptySkillBucket(),
  };
}

export function addPageToCounts(counts, records) {
  for (const r of records) {
    const year = r.year || null;
    const grade = r['id_data/grade'] || null;
    const region = r['id_data/region'] || r.region_label || null;
    const enumerator = r['id_data/enumerator'] || null;
    const schoolCode = r['id_data/school'] || null;
    const schoolName = r['id_data/school_name'] || null;
    const submittedDate = (r._submission_time || r.today || '').slice(0, 10) || null;

    counts.total_records += 1;
    bump(counts.by_year, year);
    bump(counts.by_grade, grade);
    bump(counts.by_region, region);
    bump(counts.submissions_by_date, submittedDate);
    bump(counts.by_enumerator, enumerator);

    if (schoolCode) {
      if (!counts.by_school[schoolCode]) {
        counts.by_school[schoolCode] = { name: schoolName, count: 0, by_grade: { 1: 0, 2: 0, 3: 0 } };
      }
      const school = counts.by_school[schoolCode];
      school.count += 1;
      if (grade && school.by_grade[grade] !== undefined) school.by_grade[grade] += 1;
    }

    if (!enumerator) counts.dq_flags.missing_enumerator += 1;
    if (!schoolCode) counts.dq_flags.missing_school += 1;
    if (!grade) counts.dq_flags.missing_grade += 1;

    const gradeSkills = SKILLS_BY_GRADE[grade];
    if (!gradeSkills) continue; // grade value doesn't match 1/2/3 — skip skill tally, counts above still recorded

    let anySkillFilled = false;
    for (const domain of ['reading', 'arithmetic']) {
      for (const [field, label] of gradeSkills[domain]) {
        const raw = r[field];
        if (raw === undefined || raw === null || raw === '') continue; // not attempted / not this student's grade
        anySkillFilled = true;
        const bucket = counts.skills[grade][domain][label];
        bucket.attempted += 1;
        if (raw === '1') bucket.passed += 1;
      }
    }
    if (!anySkillFilled) counts.dq_flags.submitted_but_no_skill_data += 1;
  }
  return counts;
}
