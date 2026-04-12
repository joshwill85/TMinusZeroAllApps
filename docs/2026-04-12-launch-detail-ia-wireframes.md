# 2026-04-12 Launch Detail IA Wireframes

## Platform matrix

- Customer-facing: yes
- Web: included
- iOS: included
- Android: included
- Admin/internal impact: no
- Shared API/backend impact: no

## Responsive web shell

```text
┌───────────────────────────────────────────────┐
│ Compact sticky header                         │
│ Back | Mission name | GO | T- 02:13:11 | Watch│
├───────────────────────────────────────────────┤
│ Sticky section chips                          │
│ Overview | Timeline | Viewing | Vehicle | Cov │
├───────────────────────────────────────────────┤
│ HERO                                          │
│ [GO]  T- 02:13:11                             │
│ Starlink Group 10-24                          │
│ SpaceX • Falcon 9 Block 5 • SLC-40            │
│ Tue, Apr 14 • 2:13 AM local | 6:13 AM UTC     │
│ [Watch live] [Get alerts] [Share]             │
│ [Visibility] [Weather] [Recovery]             │
│ Next event: Payload fairing deploy • T+03:10  │
├───────────────────────────────────────────────┤
│ Overview                                      │
│ Mission summary / window / orbit / pad / link │
├───────────────────────────────────────────────┤
│ Timeline                                      │
│ Next event pinned                             │
│ Next 5 milestones                             │
│ Show full mission timeline                    │
├───────────────────────────────────────────────┤
│ Viewing                                       │
│ Use my location / visibility / weather / FAA  │
│ advisories / AR & camera guide                │
├───────────────────────────────────────────────┤
│ Vehicle                                       │
│ Booster / specs / recovery / gallery /        │
│ collapsed vehicle history                     │
├───────────────────────────────────────────────┤
│ Coverage                                      │
│ Watch / resources / matched social / news     │
├───────────────────────────────────────────────┤
│ Details                                       │
│ Raw info / stats / payloads / metadata / FAQ  │
└───────────────────────────────────────────────┘

Mobile web only:
- sticky bottom CTA bar with `Watch live`
- sticky header stays compact while browser chrome shifts

Desktop:
- same hierarchy
- no sticky bottom CTA
```

## Native mobile shell

```text
┌───────────────────────────────────────────────┐
│ Native nav bar                                │
│ < Back                      Follow   Share    │
├───────────────────────────────────────────────┤
│ HERO                                          │
│ [GO]  T- 02:13:11                             │
│ Starlink Group 10-24                          │
│ SpaceX • Falcon 9 Block 5 • SLC-40            │
│ Tue, Apr 14 • 2:13 AM local                   │
│ 6:13 AM UTC                                   │
│ [Watch live] [Get alerts] [Share]             │
│ [Visibility] [Weather] [Recovery]             │
│ Next event: Payload fairing deploy • T+03:10  │
├───────────────────────────────────────────────┤
│ Pinned in-page pills                          │
│ Overview | Timeline | Viewing | Vehicle | Cov │
├───────────────────────────────────────────────┤
│ Overview group                                │
│ Timeline group                                │
│ Viewing group                                 │
│ Vehicle group                                 │
│ Coverage group                                │
│ Details group                                 │
└───────────────────────────────────────────────┘

iOS notes:
- standard navigation bar
- follow/share live in the nav bar
- medium sheets for watch options, pad map, and raw data

Android notes:
- native top app bar
- same grouped IA
- disclosures stay inline; sheets remain for watch and map flows
```
