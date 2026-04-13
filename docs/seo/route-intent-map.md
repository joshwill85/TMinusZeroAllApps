# Route Intent Map

Date: 2026-04-12

## Priority Query Clusters

The repo already contains a dedicated launch-intent landing system for 12 of the 13 supplied query clusters:

- source config: `apps/web/lib/server/launchIntentLandingConfig.ts`
- shared renderer: `apps/web/lib/server/launchIntentLanding.tsx`
- route files: `apps/web/app/(intent-landings)/*/page.tsx`

The only query in the supplied cluster list that does not use the intent-landing layer is `Artemis launch schedule`, which is already handled by `/artemis`.

## Cluster-to-Route Mapping

| Query cluster | Intended canonical route | Source files | Local production status | Current live fallback | Notes |
| --- | --- | --- | --- | --- | --- |
| `rocket launches today` | `/rocket-launches-today` | `apps/web/app/(intent-landings)/rocket-launches-today/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | `404` | `/` | fallback homepage currently `500`, so this cluster is effectively broken end-to-end |
| `next SpaceX launch` | `/next-spacex-launch` | `apps/web/app/(intent-landings)/next-spacex-launch/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | `404` | `/launch-providers/spacex` | fallback exists but is weaker than the dedicated route |
| `SpaceX launch schedule` | `/spacex-launch-schedule` | `apps/web/app/(intent-landings)/spacex-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | `404` | `/launch-providers/spacex` | dedicated route exists in source and routes manifest but is not live |
| `Falcon 9 launch schedule` | `/falcon-9-launch-schedule` | `apps/web/app/(intent-landings)/falcon-9-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | `404` | `/spacex/missions/falcon-9` | fallback page is thematically right but weaker and under-schema |
| `Starship launch schedule` | `/starship-launch-schedule` | `apps/web/app/(intent-landings)/starship-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | `404` | `/starship` | `/starship` is the current best live page |
| `Blue Origin launch schedule` | `/blue-origin-launch-schedule` | `apps/web/app/(intent-landings)/blue-origin-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | `404` | `/launch-providers/blue-origin` | fallback is a provider-schedule page |
| `ULA launch schedule` | `/ula-launch-schedule` | `apps/web/app/(intent-landings)/ula-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | `404` | `/launch-providers/united-launch-alliance-ula` | fallback exists, but no dedicated launch-intent page is live |
| `NASA launch schedule` | `/nasa-launch-schedule` | `apps/web/app/(intent-landings)/nasa-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | `404` | `/launch-providers/nasa` and `/artemis` | NASA intent currently splits across provider and Artemis program pages |
| `Florida rocket launch schedule` | `/florida-rocket-launch-schedule` | `apps/web/app/(intent-landings)/florida-rocket-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | `404` | closest family is `/locations/[id]` | no live state-level fallback exists today |
| `Cape Canaveral launch schedule` | `/cape-canaveral-launch-schedule` | `apps/web/app/(intent-landings)/cape-canaveral-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | `404` | closest family is `/locations/[id]` | no exact live canonical is currently serving |
| `Vandenberg launch schedule` | `/vandenberg-launch-schedule` | `apps/web/app/(intent-landings)/vandenberg-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | `404` | closest family is `/locations/[id]` | same pattern as Cape Canaveral |
| `Starbase launch schedule` | `/starbase-launch-schedule` | `apps/web/app/(intent-landings)/starbase-launch-schedule/page.tsx`, `apps/web/lib/server/launchIntentLandingConfig.ts` | `404` | `/starship` | `/starship` is the current live fallback |
| `Artemis launch schedule` | `/artemis` | `apps/web/app/artemis/page.tsx` | `200` | `/artemis` | current best aligned route is already live |

## Query-Intent Conclusions

### Broad schedule intent

- Intended primary answers:
  - `/rocket-launches-today`
  - `/spacex-launch-schedule`
  - `/next-spacex-launch`
  - `/falcon-9-launch-schedule`
  - `/starship-launch-schedule`
  - `/blue-origin-launch-schedule`
  - `/ula-launch-schedule`
  - `/nasa-launch-schedule`
  - `/florida-rocket-launch-schedule`
  - `/cape-canaveral-launch-schedule`
  - `/vandenberg-launch-schedule`
  - `/starbase-launch-schedule`
- Current local production result:
  - all 12 return `404`

### Current live query winners by family

| Intent family | Best current live family | Why |
| --- | --- | --- |
| broad US launch schedule | `/` | still the broadest canonical schedule page in source, but currently `500` in local production |
| provider launch schedule | `/launch-providers/[slug]` | clear provider-schedule template with `CollectionPage` and `ItemList` schema |
| provider news / coverage | `/providers/[slug]` | useful entity page, but should consolidate ranking to `/launch-providers/[slug]` |
| location schedule | `/locations/[id]` | strongest live location-specific schedule family |
| vehicle schedule | `/rockets/[id]` | strongest live vehicle-specific schedule family |
| mission-family schedule | `/spacex/missions/[mission]`, `/blue-origin/missions/[mission]`, `/artemis-*`, `/starship` | live, but metadata/schema quality is uneven |
| Artemis launch schedule | `/artemis` | already live and aligned |

## Internal-Link Alignment for Query Clusters

Current link graph is weak for the exact target cluster pages:

- `apps/web/components/ProgramHubDock.tsx` only links `/artemis`, `/spacex`, and `/blue-origin`.
- `apps/web/app/site-map/page.tsx` links `/launch-providers` and provider schedule pages, but not the 12 intent-landing routes.
- `apps/web/app/page.tsx` does not link the 12 intent-landing routes.
- `apps/web/lib/server/launchIntentLandingConfig.ts` links the intent pages to each other, but those links matter only after a crawler can reach one of them.

Result:

- The intent layer is architecturally correct for the supplied query clusters.
- The intent layer is operationally disconnected because the routes are not live and are not discoverable via internal linking.

## Recommended Canonical Winners for the Supplied Query List

| Query cluster | Recommended canonical winner |
| --- | --- |
| `rocket launches today` | `/rocket-launches-today` |
| `next SpaceX launch` | `/next-spacex-launch` |
| `SpaceX launch schedule` | `/spacex-launch-schedule` |
| `Falcon 9 launch schedule` | `/falcon-9-launch-schedule` |
| `Starship launch schedule` | `/starship-launch-schedule` |
| `Blue Origin launch schedule` | `/blue-origin-launch-schedule` |
| `ULA launch schedule` | `/ula-launch-schedule` |
| `NASA launch schedule` | `/nasa-launch-schedule` |
| `Florida rocket launch schedule` | `/florida-rocket-launch-schedule` |
| `Cape Canaveral launch schedule` | `/cape-canaveral-launch-schedule` |
| `Vandenberg launch schedule` | `/vandenberg-launch-schedule` |
| `Starbase launch schedule` | `/starbase-launch-schedule` |
| `Artemis launch schedule` | `/artemis` |

