# Run

Requires Node.js 18 or newer. From this repository's directory:

```bash
npm install
node swim-schedule.js
node swim-schedule.js --days 1
node swim-schedule.js --date 2026-11-13
node swim-schedule.js --date 2026-11-13 --time 10:30
node swim-schedule.js --days 14
```

The first command installs dependencies. The default schedule covers seven calendar days, including today; `--days 1` shows today, and `--date YYYY-MM-DD` shows a selected day. `--days` selects a different horizon. Run tests with `npm test`.

Use `--time HH:MM` (24-hour Edmonton time) on its own or with `--days` or `--date` to list overlaps containing that time first. Other overlaps remain in the table. The requested time must be before the displayed end time.

## Swimming schedules

The table combines Edmonton and Strathcona results in chronological order. Results show remaining overlaps for today and full-day overlaps for other dates between scheduled lane swimming and an explicitly listed tot/kids pool or a candidate leisure pool. A candidate leisure pool is not necessarily a separate kiddie pool. Lane counts are shown only when published, and overlapping lane activities are listed separately rather than added together.

Edmonton's open-data feeds have a rolling seven-day horizon, so longer requests cannot provide a complete Edmonton schedule. Strathcona's calendar export also has a limited and variable horizon. An empty result does not prove a facility has no swimming. City facility notices are displayed for relevant facilities, but may cover different dates or amenities. Schedules are not real-time availability; check the linked sources and call ahead about closures, restrictions, child suitability, and lane availability. Edmonton's 311 number is a city contact, not a direct facility number.

The script exits nonzero when a source cannot be retrieved or parsed; partial results may still be printed.