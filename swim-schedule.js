#!/usr/bin/env node
'use strict';

const ICAL = require('ical.js');

const SOURCES = {
  pools: 'https://data.edmonton.ca/resource/y7pw-4xyu.json?$limit=50000',
  lanes: 'https://data.edmonton.ca/resource/7afh-aawr.json?$limit=50000',
  notices: 'https://data.edmonton.ca/resource/f8c5-vjun.json?$limit=50000',
  county: 'https://www.trumba.com/calendars/swimming-1.ics',
};
const CITY_DIRECTORY = 'https://www.edmonton.ca/activities_parks_recreation/recreation-leisure-centres-pools';
const COUNTY_SCHEDULE = 'https://www.strathcona.ca/recreation-events/activities/swimming/';
const CITY = {
  ACT: ['ACT Aquatic & Recreation Centre', 'act', 'ACT'],
  LLC: ['Londonderry Fitness & Leisure Centre', 'londonderry', 'Londonderry'],
  OLC: ["O'Leary Leisure Centre", 'oleary', "O'Leary"],
  MWRC: ['Mill Woods Recreation Centre', 'mill-woods', 'Mill Woods'],
  TCRC: ['Booster Juice Recreation Centre in Terwillegar', 'terwillegar', 'Terwillegar'],
  TMCRC: ['The Meadows Community Recreation Centre', 'meadows', 'The Meadows'],
  CCRC: ['Commonwealth Community Recreation Centre', 'commonwealth', 'Commonwealth'],
};
const COUNTY = {
  'Kinsmen Leisure Centre': ['780-400-3866', 'https://www.strathcona.ca/recreation-events/recreation-centres/kinsmen-leisure-centre/'],
  'Emerald Hills Leisure Centre': ['780-464-2112', 'https://www.strathcona.ca/recreation-events/recreation-centres/emerald-hills-leisure-centre/'],
  'Millennium Place': ['780-416-3300', 'https://www.strathcona.ca/recreation-events/recreation-centres/millennium-place/'],
};
const DAY = 24 * 60;

function laneCount(activity) {
  const match = activity.match(/\b(\d+)\s+lanes?\b/i);
  return match ? Number(match[1]) : null;
}

function activeWindows(row) {
  const windows = [];
  let start = null;
  for (let minute = 0; minute <= DAY; minute += 15) {
    const key = `_${String(Math.floor(minute / 60)).padStart(2, '0')}${String(minute % 60).padStart(2, '0')}`;
    const active = minute < DAY && Number(row[key] || 0) > 0;
    if (active && start === null) start = minute;
    if (!active && start !== null) {
      windows.push([start, minute]);
      start = null;
    }
  }
  return windows;
}

function dayNumber(date) {
  const [year, month, day] = date.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 60000);
}

function dateString(minute) {
  return new Date(minute * 60000).toISOString().slice(0, 10);
}

function localNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date()).map(({ type, value }) => [type, value]));
  return dayNumber(`${parts.year}-${parts.month}-${parts.day}`) + Number(parts.hour) * 60 + Number(parts.minute);
}

function eventFromRow(row, kind) {
  const start = dayNumber(row.bookingdate.slice(0, 10));
  return activeWindows(row).map(([from, to]) => ({
    facility: row.facilitycode, start: start + from, end: start + to,
    label: kind === 'pool' ? `${row.activity} (${row.lane})` : row.activity,
    certainty: row.lane === 'Tot Pool' ? 'tot pool' : 'leisure pool: verify child suitability',
  }));
}

function cityEvents(poolRows, laneRows) {
  const pools = poolRows.filter((row) => CITY[row.facilitycode] &&
    (row.lane === 'Tot Pool' || (/^Leisure(?:\/Wave)? Pool$/i.test(row.lane || '') && /public swim/i.test(row.activity || ''))))
    .flatMap((row) => eventFromRow(row, 'pool'));
  const lanes = laneRows.filter((row) => CITY[row.facilitycode] && /\blane\b/i.test(row.activity || '') && !/training|walking/i.test(row.activity))
    .flatMap((row) => eventFromRow(row, 'lane'));
  return { pools, lanes };
}

function icalMinute(time, timezone) {
  if (!time || time.isDate) throw new Error('Calendar event has no timed start or end');
  if (time.zone && time.zone.tzid === 'UTC') {
    const instant = new Date(Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute));
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Edmonton', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(instant).map(({ type, value }) => [type, value]));
    return dayNumber(`${parts.year}-${parts.month}-${parts.day}`) + Number(parts.hour) * 60 + Number(parts.minute);
  }
  if (timezone && timezone !== 'America/Edmonton') throw new Error(`Unsupported calendar timezone: ${timezone}`);
  return Math.floor(Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute) / 60000);
}

function countyEvents(text) {
  const calendar = new ICAL.Component(ICAL.parse(text));
  const pools = [];
  const lanes = [];
  let coverageEnd = null;
  for (const component of calendar.getAllSubcomponents('vevent')) {
    const event = new ICAL.Event(component);
    if (!COUNTY[event.location] || !event.startDate || !event.endDate) continue;
    const start = icalMinute(event.startDate, component.getFirstProperty('dtstart').getParameter('tzid'));
    const end = icalMinute(event.endDate, component.getFirstProperty('dtend').getParameter('tzid'));
    coverageEnd = Math.max(coverageEnd ?? end, end);
    const label = event.summary || '';
    const item = { facility: event.location, start, end, label };
    if (/^kids pool\s*-\s*drop in/i.test(label)) pools.push({ ...item, certainty: 'kids pool (ages 0-5)' });
    else if (event.location === 'Millennium Place' && /^non-wave rec swim/i.test(label)) pools.push({ ...item, certainty: 'zero-depth leisure pool: verify child suitability' });
    else if (/^lap swim\b/i.test(label)) lanes.push(item);
  }
  return { pools, lanes, coverageEnd };
}

function overlaps(pools, lanes, from, until) {
  const results = [];
  for (const pool of pools) {
    const candidates = lanes.filter((lane) => lane.facility === pool.facility && lane.start < pool.end && lane.end > pool.start);
    const boundaries = [...new Set([Math.max(pool.start, from), Math.min(pool.end, until),
      ...candidates.flatMap((lane) => [Math.max(lane.start, pool.start, from), Math.min(lane.end, pool.end, until)])])]
      .filter((point) => point >= Math.max(pool.start, from) && point <= Math.min(pool.end, until)).sort((a, b) => a - b);
    for (let index = 0; index + 1 < boundaries.length; index++) {
      const start = boundaries[index];
      const end = boundaries[index + 1];
      const labels = [...new Set(candidates.filter((lane) => lane.start < end && lane.end > start).map((lane) => lane.label))].sort();
      if (!labels.length || end <= from) continue;
      const previous = results.at(-1);
      if (previous && previous.pool === pool && previous.end === start && previous.labels.join('\0') === labels.join('\0')) previous.end = end;
      else results.push({ pool, start, end, labels });
    }
  }
  return results.sort((left, right) => left.start - right.start || left.pool.facility.localeCompare(right.pool.facility));
}

async function getSource(url, type) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'User-Agent': 'TyFi-swim-schedule/1.0' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return type === 'json' ? response.json() : response.text();
}

function printTime(minute) {
  const date = new Date(minute * 60000);
  return `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`;
}

function cityNotices(notices, code) {
  const key = CITY[code][2].toLowerCase();
  const pattern = new RegExp(`(?:^|[^a-z0-9])${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^a-z0-9])`, 'i');
  return notices.filter((notice) => pattern.test(notice.facility_service_name || '') && notice.status);
}

function printResults(title, results, notices) {
  console.log(`\n${title}`);
  if (!results.length) console.log('  No matching overlaps found in the available data.');
  for (const { pool, start, end, labels } of results) {
    const city = CITY[pool.facility];
    const county = COUNTY[pool.facility];
    const name = city ? city[0] : pool.facility;
    const url = city ? `https://www.edmonton.ca/activities_parks_recreation/${city[1]}` : county[1];
    console.log(`\n${printTime(start)} - ${printTime(end)} | ${name}`);
    console.log(`  Pool: ${pool.label} [${pool.certainty}]`);
    for (const label of labels) {
      const count = laneCount(label);
      console.log(`  Lane swim: ${label} | ${count === null ? 'lane count unknown' : `${count} lanes`}`);
    }
    console.log(`  Contact: ${city ? 'Edmonton 311 (outside Edmonton: 780-442-5311)' : county[0]} | ${url}`);
    if (city && notices && cityNotices(notices, pool.facility).length) console.log('  WARNING: Facility notices below may affect this schedule.');
  }
  if (notices) {
    const facilities = [...new Set(results.map(({ pool }) => pool.facility))];
    for (const code of facilities) {
      const entries = cityNotices(notices, code);
      if (!entries.length) continue;
      console.log(`\nNotices for ${CITY[code][0]} (dates may not overlap the listed swim):`);
      for (const notice of entries) console.log(`  ${notice.status} | ${notice.service || 'facility'} | ${notice.notice_date_information || 'dates unspecified'} | ${(notice.additional_information || '').replace(/\s+/g, ' ').trim()}`);
    }
  }
}

async function main(args) {
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: node swim-schedule.js [--days N]\nShows overlapping kids/leisure pool and lane swim schedules, starting today (default: 7 days).');
    return 0;
  }
  const days = args.length === 0 ? 7 : args.length === 2 && args[0] === '--days' && /^\d+$/.test(args[1]) ? Number(args[1]) : NaN;
  if (!Number.isSafeInteger(days) || days < 1 || days > 365) {
    console.error('Usage: node swim-schedule.js [--days N] (N must be between 1 and 365)');
    return 2;
  }
  const now = localNow();
  const from = Math.floor(now / DAY) * DAY;
  const until = from + days * DAY;
  console.log(`Swimming overlaps, ${dateString(from)} through ${dateString(until - 1)} (America/Edmonton)`);
  console.log('Call ahead: schedules and lane counts are planned, not real-time availability. Restrictions and closures may apply.');
  const keys = Object.keys(SOURCES);
  const responses = await Promise.allSettled(keys.map((key) => getSource(SOURCES[key], key === 'county' ? 'text' : 'json')));
  const data = Object.fromEntries(responses.map((response, index) => {
    if (response.status === 'rejected') console.error(`WARNING: ${keys[index]} source unavailable: ${response.reason.message}`);
    return [keys[index], response.status === 'fulfilled' ? response.value : null];
  }));
  let failed = responses.some((response) => response.status === 'rejected');
  if (data.pools && data.lanes) {
    const { pools, lanes } = cityEvents(data.pools, data.lanes);
    const latestDates = [data.pools, data.lanes].map((rows) => rows.reduce((latest, row) => row.bookingdate ? Math.max(latest, dayNumber(row.bookingdate.slice(0, 10))) : latest, -Infinity));
    const cityLast = Math.min(...latestDates);
    console.log(`\nEdmonton feed coverage ends ${Number.isFinite(cityLast) ? dateString(cityLast) : 'unknown'}; future dates beyond this are not included.`);
    if (days > 7 || until > cityLast + DAY) console.log('WARNING: Edmonton open data has a rolling seven-day horizon; requested dates may be missing.');
    if ([data.pools, data.lanes, data.notices].some((rows) => rows && rows.length >= 50000)) console.log('WARNING: An Edmonton feed reached its row limit and may be incomplete.');
    if (!data.notices) console.log('WARNING: Closure notices could not be checked.');
    printResults('Edmonton', overlaps(pools, lanes, from, until).filter((entry) => entry.end > now), data.notices);
  } else console.log(`\nEdmonton schedules unavailable. Facility directory: ${CITY_DIRECTORY}`);
  if (data.county) {
    try {
      const { pools, lanes, coverageEnd } = countyEvents(data.county);
      console.log(`\nStrathcona calendar's latest event ends ${coverageEnd === null ? 'unknown' : printTime(coverageEnd)}; this is not a completeness guarantee.`);
      if (coverageEnd === null || until > coverageEnd) console.log('WARNING: Requested dates extend beyond the county calendar export.');
      printResults('Strathcona County', overlaps(pools, lanes, from, until).filter((entry) => entry.end > now));
    } catch (error) {
      failed = true;
      console.error(`WARNING: Could not parse Strathcona calendar: ${error.message}`);
    }
  }
  console.log(`\nCheck city notifications: https://coewebapps.edmonton.ca/facilitynotifications/\nCounty schedule: ${COUNTY_SCHEDULE}`);
  return failed ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { activeWindows, laneCount, cityEvents, countyEvents, dayNumber, overlaps, cityNotices, main };