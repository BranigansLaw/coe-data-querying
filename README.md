# Run

Requires Node.js 18 or newer. From this repository's directory:

```bash
npm install
node swim-schedule.js
node swim-schedule.js --days 14
```

The first command installs dependencies. The default schedule covers seven calendar days, including today; `--days` selects a different horizon. Run tests with `npm test`.

## Swimming schedules

Results show remaining overlaps between scheduled lane swimming and an explicitly listed tot/kids pool or a candidate leisure pool. A candidate leisure pool is not necessarily a separate kiddie pool. Lane counts are shown only when published, and overlapping lane activities are listed separately rather than added together.

Edmonton's open-data feeds have a rolling seven-day horizon, so longer requests cannot provide a complete Edmonton schedule. Strathcona's calendar export also has a limited and variable horizon. An empty result does not prove a facility has no swimming. City facility notices are displayed for relevant facilities, but may cover different dates or amenities. Schedules are not real-time availability; check the linked sources and call ahead about closures, restrictions, child suitability, and lane availability. Edmonton's 311 number is a city contact, not a direct facility number.

The script exits nonzero when a source cannot be retrieved or parsed; partial results may still be printed.