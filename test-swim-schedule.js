'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { activeWindows, laneCount, cityEvents, countyEvents, dayNumber, overlaps, cityNotices, printResults, parseScheduleArgs, main } = require('./swim-schedule');

test('slot values are activity indicators and windows are half-open', () => {
  assert.deepEqual(activeWindows({ _0530: '1', _0545: '2', _2330: '1', _2345: '1' }), [[330, 360], [1410, 1440]]);
  assert.equal(laneCount('Lane Swim (25 Metres) 3 Lanes'), 3);
  assert.equal(laneCount('Lap Swim - Deep'), null);
});

test('city overlaps split on lane changes without inventing counts', () => {
  const base = { facilitycode: 'MWRC', bookingdate: '2026-11-12T00:00:00.000' };
  const pool = { ...base, activity: 'Play Date at the Pool', lane: 'Tot Pool', _1000: '1', _1015: '1', _1030: '1' };
  const first = { ...base, activity: 'Lane Swim 3 Lanes', _1000: '1', _1015: '1' };
  const second = { ...base, activity: 'Lane Swim 25 m', _1030: '1' };
  const { pools, lanes } = cityEvents([pool], [first, second]);
  const start = dayNumber('2026-11-12');
  const result = overlaps(pools, lanes, start, start + 1440);
  assert.deepEqual(result.map((entry) => [entry.start - start, entry.end - start, entry.labels]), [
    [600, 630, ['Lane Swim 3 Lanes']], [630, 645, ['Lane Swim 25 m']],
  ]);
  assert.equal(overlaps(pools, lanes, start + 645, start + 1440).length, 0);
});

test('county calendar matches kids pool and lap swim, excluding walking lanes', () => {
  const event = (summary, start, end) => `BEGIN:VEVENT\r\nUID:${summary}\r\nSUMMARY:${summary}\r\nLOCATION:Emerald Hills Leisure Centre\r\nDTSTART;TZID=America/Edmonton:20261112T${start}00\r\nDTEND;TZID=America/Edmonton:20261112T${end}00\r\nEND:VEVENT\r\n`;
  const text = `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${event('Kids Pool - Drop In (0-5Y)', '0900', '1100')}${event('Lap Swim - Shallow (4 lanes)', '1000', '1200')}${event('Walking Lanes - 1.3 Metres (4 lanes)', '0900', '1100')}END:VCALENDAR\r\n`;
  const { pools, lanes } = countyEvents(text);
  const start = dayNumber('2026-11-12');
  const result = overlaps(pools, lanes, start, start + 1440);
  assert.equal(result.length, 1);
  assert.equal(result[0].start, start + 600);
  assert.equal(result[0].end, start + 660);
  assert.deepEqual(result[0].labels, ['Lap Swim - Shallow (4 lanes)']);
});

test('calendar UTC times convert to Edmonton time across daylight saving', () => {
  const text = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Kids Pool - Drop In (0-5Y)\r\nLOCATION:Kinsmen Leisure Centre\r\nDTSTART:20261112T160000Z\r\nDTEND:20261112T170000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  const { pools } = countyEvents(text);
  assert.equal(pools[0].start, dayNumber('2026-11-12') + 9 * 60);
});

test('closure matching uses the facility short name', () => {
  const notices = [
    { facility_service_name: 'Londonderry Fitness and Leisure Centre', status: 'Will be closed' },
    { facility_service_name: 'Booster Juice Recreation Centre in Terwillegar', status: 'Closed' },
    { facility_service_name: 'ACT Aquatic & Recreation Centre', status: 'Closed' },
  ];
  assert.equal(cityNotices(notices, 'LLC').length, 1);
  assert.equal(cityNotices(notices, 'ACT').length, 1);
  assert.equal(cityNotices(notices, 'TCRC').length, 1);
});

test('one table combines both municipalities chronologically and retains notices and contacts', () => {
  const date = dayNumber('2026-11-12');
  const city = { pool: { facility: 'LLC', label: 'Tot Pool', certainty: 'tot pool' }, start: date + 600, end: date + 660, labels: ['Lane Swim (25 Metres) 3 Lanes'] };
  const county = { pool: { facility: 'Kinsmen Leisure Centre', label: 'Kids Pool', certainty: 'kids pool (ages 0-5)' }, start: date + 540, end: date + 600, labels: ['Lap Swim - Deep'] };
  const notices = [{ facility_service_name: 'Londonderry Fitness and Leisure Centre', status: 'Will be closed', service: 'All', notice_date_information: 'Nov 09 to Nov 15' }];
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    printResults([city, county], notices);
  } finally {
    console.log = originalLog;
  }
  const output = lines.join('\n');
  assert.ok(output.indexOf('09:00-10:00') < output.indexOf('10:00-11:00'));
  assert.ok(output.includes('Kinsmen Leisure Centre'));
  assert.ok(output.includes('Londonderry'));
  assert.ok(output.includes('Will be closed'));
  assert.ok(output.includes('780-400-3866'));
  assert.ok(output.includes('? deep'));
  assert.ok(output.includes('3 lanes (25m)'));
});

test('rejects invalid horizons without fetching', async () => {
  assert.equal(await main(['--days', '0']), 2);
});

test('one-day options use Edmonton calendar dates and reject invalid dates', () => {
  const now = dayNumber('2026-11-12') + 700;
  assert.deepEqual(parseScheduleArgs(['--days', '1'], now), { from: dayNumber('2026-11-12'), until: dayNumber('2026-11-13') });
  assert.deepEqual(parseScheduleArgs(['--date', '2026-12-31'], now), { from: dayNumber('2026-12-31'), until: dayNumber('2027-01-01') });
  assert.deepEqual(parseScheduleArgs(['--date', '2024-02-29'], now), { from: dayNumber('2024-02-29'), until: dayNumber('2024-03-01') });
  assert.equal(parseScheduleArgs(['--date', '2026-02-29'], now), null);
  assert.equal(parseScheduleArgs(['--date', '2026-13-01'], now), null);
  assert.equal(parseScheduleArgs(['--date', '2026-11-12', '--days', '2'], now), null);
});

test('requested time works with either date option in any order', () => {
  const now = dayNumber('2026-11-12') + 700;
  assert.deepEqual(parseScheduleArgs(['--time', '00:00'], now), { from: dayNumber('2026-11-12'), until: dayNumber('2026-11-19'), requestedTime: 0 });
  assert.deepEqual(parseScheduleArgs(['--date', '2026-11-13', '--time', '10:30'], now), { from: dayNumber('2026-11-13'), until: dayNumber('2026-11-14'), requestedTime: 630 });
  assert.deepEqual(parseScheduleArgs(['--time', '23:59', '--days', '1'], now), { from: dayNumber('2026-11-12'), until: dayNumber('2026-11-13'), requestedTime: 1439 });
  for (const args of [['--time', '24:00'], ['--time', '10:60'], ['--time', '9:30'], ['--time'], ['--time', '10:00', '--time', '11:00']]) {
    assert.equal(parseScheduleArgs(args, now), null);
  }
});

test('requested time prioritizes matching overlaps and keeps other rows', () => {
  const date = dayNumber('2026-11-12');
  const makeEntry = (facility, start, end) => ({ pool: { facility, label: 'Tot Pool', certainty: 'tot pool' }, start: date + start, end: date + end, labels: ['Lane Swim (25 Metres) 3 Lanes'] });
  const entries = [makeEntry('LLC', 540, 600), makeEntry('OLC', 600, 660), makeEntry('MWRC', 570, 630), makeEntry('TCRC', 660, 720)];
  const originalLog = console.log;
  const lines = [];
  console.log = (line) => lines.push(line);
  try {
    printResults(entries, [], 600);
  } finally {
    console.log = originalLog;
  }
  const output = lines.join('\n');
  assert.ok(output.indexOf('09:30-10:30') < output.indexOf('10:00-11:00'));
  assert.ok(output.indexOf('10:00-11:00') < output.indexOf('09:00-10:00'));
  assert.ok(output.indexOf('09:00-10:00') < output.indexOf('11:00-12:00'));
  assert.ok(output.includes('Timeframes containing 10:00 are listed first'));
});

test('selected day combines source results in chronological order', async () => {
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const output = [];
  const base = { facilitycode: 'MWRC', bookingdate: '2099-01-03T00:00:00.000' };
  const calendar = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Kids Pool - Drop In (0-5Y)\r\nLOCATION:Kinsmen Leisure Centre\r\nDTSTART;TZID=America/Edmonton:20990103T090000\r\nDTEND;TZID=America/Edmonton:20990103T103000\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:2\r\nSUMMARY:Lap Swim - Deep\r\nLOCATION:Kinsmen Leisure Centre\r\nDTSTART;TZID=America/Edmonton:20990103T090000\r\nDTEND;TZID=America/Edmonton:20990103T103000\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';
  global.fetch = async (url) => ({
    ok: true,
    json: async () => url.includes('y7pw-4xyu') ? [{ ...base, activity: 'Tot Pool', lane: 'Tot Pool', _1000: '1' }]
      : url.includes('7afh-aawr') ? [{ ...base, activity: 'Lane Swim (25 Metres) 3 Lanes', _1000: '1' }] : [],
    text: async () => calendar,
  });
  console.log = console.error = (...args) => output.push(args.join(' '));
  try {
    assert.equal(await main(['--date', '2099-01-03']), 0);
    const text = output.join('\n');
    assert.ok(text.includes('2099-01-03 | 09:00-10:30 | Kinsmen'));
    assert.ok(text.includes('2099-01-03 | 10:00-10:15 | Mill Woods'));
    assert.ok(text.indexOf('09:00-10:30') < text.indexOf('10:00-10:15'));
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
});

test('reports partial source failure', async () => {
  const originalFetch = global.fetch;
  const originalLog = console.log;
  const originalError = console.error;
  const messages = [];
  global.fetch = async (url) => {
    if (url.includes('f8c5-vjun')) throw new Error('offline');
    return { ok: true, json: async () => [], text: async () => 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n' };
  };
  console.log = console.error = (...args) => messages.push(args.join(' '));
  try {
    assert.equal(await main([]), 1);
    assert.ok(messages.some((message) => message.includes('Closure notices could not be checked')));
  } finally {
    global.fetch = originalFetch;
    console.log = originalLog;
    console.error = originalError;
  }
});