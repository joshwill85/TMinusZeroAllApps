# Data Attribution Audit (2026-03-05)

Generated at: 2026-03-05T01:31:34.042Z

## Scope
- Active and dormant data-source integrations.
- Public attribution/disclosure statements in legal/docs/UI copy.
- Policy baseline: provider terms + internal attribution policy.

## Summary
- Total sources: **15**
- Active sources: **14**
- Dormant sources: **1**
- Attribution claims mapped: **20**
- Compliance: compliant **14**, missing **0**, over-attributed **0**, unclear **1**

## Source Matrix
| Source key | Mode | Scope | Requirement | Compliance | Priority | Notes |
|---|---|---|---|---|---|---|
| ll2_launch_library | active | core | recommended | compliant | none | Primary launch feed source; product policy is to credit LL2 throughout launch surfaces. |
| snapi_news | active | core | recommended | compliant | none | SNAPI data is actively ingested and displayed on multiple pages. |
| nws_weather | active | core | recommended | compliant | none | NWS is a first-class weather source and already disclosed in legal and launch surfaces. |
| ws45_forecast | active | feature | recommended | compliant | none | WS45 source is disclosed on both launch weather surfaces and the legal data attribution page. |
| open_meteo_weather | active | feature | required | compliant | none | Open-Meteo is the primary weather input for JEP scoring and appears on launch detail surfaces. |
| faa_tfr_notam | active | feature | recommended | compliant | none | Feature surface already labels FAA source and links to original advisories. |
| navcen_bnm | active | feature | recommended | compliant | none | Trajectory constraints sourced from NAVCEN BNM are disclosed on the legal data attribution page. |
| celestrak_orbit_satcat | active | feature | recommended | compliant | none | CelesTrak-powered satellite/orbit datasets are listed on the legal data attribution page. |
| artemis_nasa_public_data | active | feature | required | compliant | none | Artemis program sources are disclosed on legal data surfaces with NASA source acknowledgment. |
| blue_origin_official_channels | active | feature | recommended | compliant | none | Blue Origin pages and media channels are first-party inputs for mission status, timelines, and media archive evidence. |
| blue_origin_wayback_archive | active | feature | recommended | compliant | none | Wayback snapshots fill coverage gaps where current official mission pages no longer expose legacy crew/passenger details. |
| wikipedia_blue_origin_travelers | active | feature | recommended | compliant | none | Wikipedia-derived profile enrichment improves passenger identity resolution and traveler context where first-party data is sparse. |
| spacex_website_content | active | feature | unknown | unclear | P1 | Mission profile imagery is rendered from SpaceX-hosted URLs with outbound source linking; rights requirements remain unclear and are tracked internally. |
| wikimedia_wikidata_drone_ships | active | feature | recommended | compliant | none | Drone-ship profile pages enrich operational launch data with openly available ship facts and image metadata. |
| celestrak_supgp_optional | dormant | feature | recommended | compliant | none | Configured integration exists but is disabled by default in current migrations/settings. |

## Claim Inventory
| Source key | Surface | Claim |
|---|---|---|
| ll2_launch_library | `app/legal/data/page.tsx` | Launch data provided by The Space Devs (Launch Library 2). |
| snapi_news | `app/legal/data/page.tsx` | News metadata powered by Spaceflight News API (The Space Devs). |
| nws_weather | `app/legal/data/page.tsx` | Weather forecasts (US-only): National Weather Service (NWS) API. |
| ws45_forecast | `app/legal/data/page.tsx` | Feature-specific sources list includes 45th Weather Squadron forecast documents. |
| open_meteo_weather | `app/legal/data/page.tsx` | Feature-specific sources list includes Open-Meteo forecast API for visibility scoring. |
| faa_tfr_notam | `app/legal/data/page.tsx` | Feature-specific sources list includes FAA TFR/NOTAM feeds. |
| celestrak_orbit_satcat | `app/legal/data/page.tsx` | Feature-specific sources list includes CelesTrak satellite/orbit datasets. |
| navcen_bnm | `app/legal/data/page.tsx` | Feature-specific sources list includes U.S. Coast Guard NAVCEN BNM feed. |
| artemis_nasa_public_data | `app/legal/data/page.tsx` | Feature-specific sources list includes NASA Artemis + U.S. public-sector program data. |
| ll2_launch_library | `app/docs/faq/page.tsx` | Launch schedule and metadata come from LL2; news from SNAPI. |
| snapi_news | `app/news/page.tsx` | Incoming coverage packets pulled from Spaceflight News API. |
| snapi_news | `app/providers/[slug]/page.tsx` | Latest coverage tied to provider launches from Spaceflight News API. |
| snapi_news | `app/launches/[id]/page.tsx` | Related coverage linked via Spaceflight News API. |
| nws_weather | `app/launches/[id]/page.tsx` | NWS forecast for the pad location at T-0 (api.weather.gov). |
| faa_tfr_notam | `app/launches/[id]/page.tsx` | FAA airspace advisories section with source links. |
| spacex_website_content | `app/launches/[id]/page.tsx` | Mission profile section displays Source: SpaceX and links media to the SpaceX launch page. |
| ws45_forecast | `components/Ws45ForecastPanel.tsx` | Forecast panel labels source as 45th Weather Squadron PDFs. |
| open_meteo_weather | `components/JepScorePanel.tsx` | JEP panel labels weather input as Open-Meteo with NWS fallback. |
| blue_origin_official_channels | `app/blue-origin/page.tsx` | New Shepard snapshot status links to Blue Origin official pause-flights update. |
| ll2_launch_library | `components/Footer.tsx` | Footer includes LL2 attribution line. |

## Open Findings (Non-Blocking)
- **SpaceX launch website content API** (spacex_website_content): Keep linked source labeling on launch detail pages and track SpaceX rights clarification in the internal risk register (non-blocking).

## Policy Evidence
- **Launch Library 2 (LL2)**: [LL2 landing page](https://thespacedevs.com/llapi)
- **Spaceflight News API (SNAPI)**: [SNAPI homepage](https://spaceflightnewsapi.net/), [SNAPI docs](https://api.spaceflightnewsapi.net/v4/docs)
- **NWS API (api.weather.gov)**: [NWS API documentation](https://www.weather.gov/documentation/services-web-api)
- **45th Weather Squadron forecast PDFs**: [45 WS launch forecast support portal](https://45thweathersquadron.nebula.spaceforce.mil/pages/launchForecastSupport.html)
- **Open-Meteo Forecast API**: [Open-Meteo terms](https://open-meteo.com/en/terms)
- **FAA TFR/NOTAM feeds**: [FAA TFR API endpoint](https://tfr.faa.gov/tfrapi/getTfrList), [USA.gov copyright policy overview](https://www.usa.gov/government-works)
- **NAVCEN BNM hazard feed**: [NAVCEN BNM source endpoint](https://www.navcen.uscg.gov/broadcast-notice-to-mariners-message)
- **CelesTrak GP/SATCAT datasets**: [CelesTrak GP data documentation](https://celestrak.org/NORAD/documentation/gp-data-formats.php)
- **NASA Artemis feeds + oversight/procurement sources**: [NASA images and media guidance](https://www.nasa.gov/nasa-brand-center/images-and-media/)
- **Blue Origin official mission/news/media channels**: [Blue Origin mission/news index](https://www.blueorigin.com/news), [Blue Origin New Shepard pause update](https://www.blueorigin.com/news/new-shepard-to-pause-flights)
- **Wayback Machine (Blue Origin mission-page captures)**: [Internet Archive Terms of Use](https://archive.org/about/terms.php)
- **Wikipedia API (Blue Origin traveler enrichment)**: [Wikipedia API endpoint](https://en.wikipedia.org/w/api.php), [Wikimedia Foundation Terms of Use](https://foundation.wikimedia.org/wiki/Policy:Terms_of_Use)
- **SpaceX launch website content API**: [SpaceX terms page](https://www.spacex.com/legal/terms/)
- **Wikidata + Wikimedia Commons**: [Wikidata API](https://www.wikidata.org/w/api.php), [Wikimedia Commons API](https://commons.wikimedia.org/w/api.php)
- **CelesTrak SupGP supplemental feed**: [CelesTrak GP data documentation](https://celestrak.org/NORAD/documentation/gp-data-formats.php)

## Enforcement Policy
- Findings marked `missing` or `unclear` are tracked in internal remediation artifacts and do not block release by default.
- Source labeling and attribution disclosures remain required on user-facing surfaces.

## Assumptions
- Requirement classifications are best-effort based on publicly available provider policy pages.
- When policy language is not explicit, classification remains explicit (`unknown` or `recommended`) and is tracked as an internal follow-up item.
