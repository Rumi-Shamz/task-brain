import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repeatsOn, describeRepeat, normalizeRepeat, nextOccurrence, monthlyChoices } from '../js/recurring.js';
import { parseIcs, eventsToSeries, seriesToIcs, parseIcsDate } from '../js/ics.js';
import { state, seedYearRhythm } from '../js/state.js';
import { normalizeDayBlocks, blocksOnDate } from '../js/blocks.js';

const series = (repeat, extra = {}) => ({ weekdays: [1], ...extra, repeat: normalizeRepeat(repeat) });

test('weekly with interval counts weeks from the start date', () => {
  const b = series({ freq: 'weekly', interval: 2, from: '2026-10-06' }, { weekdays: [1, 3] }); // Tue, Thu
  assert.equal(repeatsOn(b, '2026-10-06'), true);
  assert.equal(repeatsOn(b, '2026-10-08'), true);
  assert.equal(repeatsOn(b, '2026-10-13'), false);
  assert.equal(repeatsOn(b, '2026-10-20'), true);
  assert.equal(repeatsOn(b, '2026-09-29'), false, 'before start');
  assert.equal(describeRepeat(b), 'Every 2 weeks on Tue, Thu');
});

test('monthly by day, by nth weekday and last weekday', () => {
  const day = series({ freq: 'monthly', from: '2026-01-31', monthly: 'day' });
  assert.equal(repeatsOn(day, '2026-03-31'), true);
  assert.equal(repeatsOn(day, '2026-02-28'), false, 'no 31st in February');
  const nth = series({ freq: 'monthly', from: '2026-10-08', monthly: 'nth' }); // 2nd Thursday
  assert.equal(repeatsOn(nth, '2026-11-12'), true);
  assert.equal(repeatsOn(nth, '2026-11-05'), false);
  assert.equal(describeRepeat(nth), 'Every month on the 2nd Thu');
  const last = series({ freq: 'monthly', from: '2026-10-30', monthly: 'last' }); // last Friday
  assert.equal(repeatsOn(last, '2026-11-27'), true);
  assert.deepEqual(monthlyChoices('2026-10-30').map(c => c.id), ['day', 'nth', 'last']);
});

test('yearly, once, until', () => {
  const bday = series({ freq: 'yearly', from: '1990-04-12' });
  assert.equal(repeatsOn(bday, '2027-04-12'), true);
  assert.equal(nextOccurrence(bday, '2026-10-06'), '2027-04-12');
  const once = series({ freq: 'once', from: '2026-10-09' });
  assert.equal(repeatsOn(once, '2026-10-09'), true);
  assert.equal(repeatsOn(once, '2026-10-16'), false);
  const ending = series({ freq: 'weekly', until: '2026-10-31' }, { weekdays: [5] });
  assert.equal(repeatsOn(ending, '2026-10-31'), true);
  assert.equal(repeatsOn(ending, '2026-11-07'), false);
});

test('old blocks keep working: weekly on work days only, no domain', () => {
  state.yearRhythm = seedYearRhythm('2026-01-05');
  state.blockSkips = [];
  const [legacy, sat] = normalizeDayBlocks([
    { id: 'deep', name: 'Deep work', weekdays: [0, 1, 2, 3, 4], startMin: 540, endMin: 720, rule: 'leverage' },
    { id: 'swing', name: 'Swing class', weekdays: [5], startMin: 1200, endMin: 1290, rule: 'event', workDaysOnly: false, domain: 'SwingSociety' },
  ]);
  assert.equal(legacy.workDaysOnly, true);
  assert.equal(legacy.repeat.freq, 'weekly');
  assert.equal(legacy.domain, null);
  state.yearRhythm.dayBlocks = [legacy, sat];
  assert.deepEqual(blocksOnDate('2026-10-10').map(b => b.id), ['swing'], 'Saturday: class, no deep work');
  state.blockSkips = [{ date: '2026-10-10', blockId: 'swing' }];
  assert.deepEqual(blocksOnDate('2026-10-10'), []);
});

const ICS = [
  'BEGIN:VCALENDAR',
  'BEGIN:VEVENT', 'UID:swing@x', 'SUMMARY:Swing class', 'DTSTART;TZID=Europe/Sofia:20260915T200000',
  'DTEND;TZID=Europe/Sofia:20260915T213000', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH', 'EXDATE;TZID=Europe/Sofia:20261013T200000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:board@x', 'SUMMARY:ALFA board\\, monthly', 'DTSTART:20260108T100000', 'DURATION:PT1H30M',
  'RRULE:FREQ=MONTHLY;BYDAY=2TH', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:bday@x', 'SUMMARY:Mum birthday', 'DTSTART;VALUE=DATE:19600312', 'RRULE:FREQ=YEARLY', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:old@x', 'SUMMARY:Old dentist', 'DTSTART:20250101T090000', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:ended@x', 'SUMMARY:Ended course', 'DTSTART:20250101T090000', 'RRULE:FREQ=WEEKLY;COUNT=4', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:soon@x', 'SUMMARY:Flight to', '  Lisbon', 'DTSTART:20261020T063000Z', 'DTEND:20261020T090000Z', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

test('ics import maps Google-style events to series and skips the past', () => {
  const { series: list, skipped } = eventsToSeries(parseIcs(ICS), { todayYmd: '2026-10-06', domain: 'SwingSociety' });
  const by = Object.fromEntries(list.map(s => [s.icsUid, s]));
  assert.deepEqual(by['swing@x'].weekdays, [1, 3]);
  assert.equal(by['swing@x'].startMin, 20 * 60);
  assert.equal(by['swing@x'].endMin, 21 * 60 + 30);
  assert.deepEqual(by['swing@x'].exdates, ['2026-10-13']);
  assert.equal(by['board@x'].name, 'ALFA board, monthly');
  assert.equal(by['board@x'].repeat.monthly, 'nth');
  assert.equal(by['board@x'].endMin - by['board@x'].startMin, 90);
  assert.equal(by['bday@x'].allDay, true);
  assert.equal(by['bday@x'].repeat.freq, 'yearly');
  assert.equal(by['soon@x'].name, 'Flight to Lisbon', 'folded line');
  assert.equal(by['soon@x'].repeat.freq, 'once');
  assert.deepEqual(skipped, { 'past one-off': 1, 'series already ended': 1 });
});

test('ics export round-trips through import', () => {
  const { series: list } = eventsToSeries(parseIcs(ICS), { todayYmd: '2026-10-06' });
  const withIds = list.map((s, i) => ({ id: 'b' + i, ...s }));
  const text = seriesToIcs(withIds, { stampYmd: '2026-10-06' });
  assert.match(text, /RRULE:FREQ=WEEKLY;BYDAY=TU,TH/);
  assert.match(text, /RRULE:FREQ=MONTHLY;BYDAY=2TH/);
  const again = eventsToSeries(parseIcs(text), { todayYmd: '2026-10-06' }).series;
  assert.equal(again.length, withIds.length);
  assert.deepEqual(again.map(s => s.repeat.freq).sort(), withIds.map(s => s.repeat.freq).sort());
  assert.deepEqual(parseIcsDate('20261006'), { ymd: '2026-10-06', min: 0, allDay: true });
});

test('a fresh install gets normalized default blocks', () => {
  state.yearRhythm = seedYearRhythm('2026-01-05');
  state.yearRhythm.dayBlocks = null;
  blocksOnDate('2026-10-07');
  assert.ok(state.yearRhythm.dayBlocks.length >= 2);
  state.yearRhythm.dayBlocks.forEach(b => {
    assert.equal(b.repeat.freq, 'weekly');
    assert.equal(b.workDaysOnly, true);
  });
});

test('ics keeps description, location and link, and exports them back', () => {
  const ics = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:class@x', 'SUMMARY:Swing class',
    'DTSTART:20261006T190000', 'DTEND:20261006T210000', 'RRULE:FREQ=WEEKLY;BYDAY=TU',
    'DESCRIPTION:Bring shoes\\nLevel 2\\, room B', 'LOCATION:Studio 5\\, Main st 1', 'URL:https://example.org/class',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const [s] = eventsToSeries(parseIcs(ics), { todayYmd: '2026-10-06' }).series;
  assert.equal(s.note, 'Bring shoes\nLevel 2, room B');
  assert.equal(s.location, 'Studio 5, Main st 1');
  assert.equal(s.url, 'https://example.org/class');
  const [again] = eventsToSeries(parseIcs(seriesToIcs([{ id: 'b1', ...s }], { stampYmd: '2026-10-06' })), { todayYmd: '2026-10-06' }).series;
  assert.deepEqual([again.note, again.location, again.url], [s.note, s.location, s.url]);
  const [kept] = normalizeDayBlocks([{ ...s, id: 'b1', url: 'javascript:alert(1)' }]);
  assert.equal(kept.note, s.note);
  assert.equal(kept.url, '', 'only http(s) links are kept');
});
