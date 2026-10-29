import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultWorkSchedule } from '../js/state.js';
import { periodForDate, stepPeriod, inPeriod } from '../js/year-period.js';

const S = defaultWorkSchedule(); // long Sep–Mar Mon 12 → Fri 12, short Apr–Aug Mon 12 → Thu 12
const span = p => `${p.kind} ${p.dates.join(',')}`;

test('long season: Mon–Thu open the work week Mon–Fri, Fri–Sun the rest Fri–Mon', () => {
  // Week of Mon 2 Nov 2026.
  for (const d of ['2026-11-02', '2026-11-03', '2026-11-05']) {
    assert.equal(span(periodForDate(d, S)), 'work 2026-11-02,2026-11-03,2026-11-04,2026-11-05,2026-11-06');
  }
  for (const d of ['2026-11-06', '2026-11-07', '2026-11-08']) {
    assert.equal(span(periodForDate(d, S)), 'rest 2026-11-06,2026-11-07,2026-11-08,2026-11-09');
  }
});

test('short season: Mon–Wed open Mon–Thu, Thu–Sun open the long weekend Thu–Mon', () => {
  // Week of Mon 4 May 2026.
  assert.equal(span(periodForDate('2026-05-06', S)), 'work 2026-05-04,2026-05-05,2026-05-06,2026-05-07');
  assert.equal(span(periodForDate('2026-05-07', S)), 'rest 2026-05-07,2026-05-08,2026-05-09,2026-05-10,2026-05-11');
  assert.equal(span(periodForDate('2026-05-10', S)), 'rest 2026-05-07,2026-05-08,2026-05-09,2026-05-10,2026-05-11');
});

test('next/prev alternate work and rest: 104 periods a year', () => {
  let p = periodForDate('2026-11-03', S);
  const seen = [];
  for (let i = 0; i < 104; i++) { seen.push(p.kind); p = stepPeriod(p, 1, S); }
  assert.equal(seen.filter(k => k === 'work').length, 52);
  assert.equal(seen.filter(k => k === 'rest').length, 52);
  assert.equal(span(p), span(periodForDate('2027-11-02', S)), 'back to the same work week a year (52 weeks) later');
  for (let i = 0; i < 104; i++) p = stepPeriod(p, -1, S);
  assert.equal(span(p), span(periodForDate('2026-11-03', S)));
  // Across the season change (Mon 30 Mar 2026 is the long season, Mon 6 Apr the short one).
  const lastLong = stepPeriod(periodForDate('2026-03-31', S), 1, S);
  assert.equal(span(lastLong), 'rest 2026-04-03,2026-04-04,2026-04-05,2026-04-06');
  assert.equal(span(stepPeriod(lastLong, 1, S)), 'work 2026-04-06,2026-04-07,2026-04-08,2026-04-09');
  assert.equal(span(stepPeriod(stepPeriod(lastLong, 1, S), -1, S)), span(lastLong));
});

test('boundary days only count their own half', () => {
  const work = periodForDate('2026-11-03', S);
  const rest = periodForDate('2026-11-07', S);
  assert.equal(inPeriod(work, '2026-11-06', 9 * 60, 10 * 60), true, 'Friday morning is work');
  assert.equal(inPeriod(rest, '2026-11-06', 9 * 60, 10 * 60), false);
  assert.equal(inPeriod(rest, '2026-11-06', 14 * 60, 15 * 60), true, 'Friday afternoon is rest');
  assert.equal(inPeriod(work, '2026-11-02', 9 * 60, 10 * 60), false, 'Monday morning is still the weekend');
  assert.equal(inPeriod(rest, '2026-11-09', 9 * 60, 10 * 60), true);
  assert.equal(inPeriod(work, '2026-11-02', 13 * 60, 14 * 60), true);
});
