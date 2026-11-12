'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { activeWindows, laneCount, cityEvents, countyEvents, dayNumber, overlaps, cityNotices, main } = require('./swim-schedule');

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

test('rejects invalid horizons without fetching', async () => {
  assert.equal(await main(['--days', '0']), 2);
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