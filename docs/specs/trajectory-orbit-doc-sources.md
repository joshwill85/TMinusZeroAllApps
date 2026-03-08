# Trajectory Orbit Docs: Press Kits / Mission Overviews (Source Research)

Last updated: 2026-01-19

## Goal

Find and track *official* (or near-official) mission documents that reliably contain orbit parameters for upcoming launches, so we can:

1) discover the doc URL(s) for a given launch,
2) re-fetch on a reasonable cadence with ETag/Last-Modified + sha256 versioning,
3) parse the specific orbit fields we care about, and
4) upsert `launch_trajectory_constraints` (`constraint_type='target_orbit'`).

## Orbit fields we want

- `inclination_deg`
- `flight_azimuth_deg` (often called “launch azimuth”)
- optional extras that help confidence/scoping:
  - `altitude_km`
  - `apogee_km`
  - `perigee_km`
  - `orbit_class` (LEO/SSO/GTO/GEO/ISS/Polar/etc.)

## Source reliability matrix (what usually has the numbers)

| Org | Typical doc | Where it’s posted | Numeric inclination? | Numeric azimuth? | Notes |
|---|---|---|---:|---:|---|
| ISRO | Mission brochure (PDF) | `isro.gov.in/media_isro/pdf/...` | ✅ | ✅ | Best “inclination + launch azimuth” source (table style). |
| ULA | Mission Overview / MOB (PDF) | `ulalaunch.com/docs/default-source/launch-booklets/...` | ✅ (varies) | ✅ (varies) | Often includes inclination/azimuth tables; some missions omit. |
| Arianespace | Launch Kit (PDF) | `newsroom.arianespace.com` → `download/?n=...pdf` | ✅ | ❌ (usually) | Inclination is common; azimuth usually absent. |
| ArianeGroup | Launch Kit (PDF) | `ariane.group/app/uploads/YYYY/MM/LAUNCH-KIT-...pdf` | ✅ | ❌ (usually) | Wording varies (“54° of inclination” style). |
| Rocket Lab | Press Kit (PDF) | `rocketlabcorp.com/assets/Uploads/...Press...pdf` | ✅ (sometimes OCR) | ❌ (usually) | Some modern kits embed key orbit numbers as graphics (OCR may be required). |
| NASA / JPL | Press kit (PDF/HTML) | `nasa.gov/...press-kit...` + `wp-content/uploads/...pdf` | ⚠️ | ⚠️ | Often great timeline/context; numeric orbit params vary by mission. |
| JAXA | Media kit (PDF) | `global.jaxa.jp/...pdf` / `humans-in-space.jaxa.jp/...pdf` | ⚠️ | ⚠️ | Good for profile/timeline; numeric orbit params vary. |
| ESA | Launch kit (HTML/PDF) | `esa.int/...launch_kit` | ⚠️ | ❌ (usually) | Often trajectory context more than strict numbers. |
| SpaceX | Mission page + mission JSON (HTML/JSON) | `spacex.com/launches/<slug>` + `content.spacex.com/...` | ❌ (Starlink) | ❌ | Great for timeline/infographics; numeric orbit params often not published. |
| Blue Origin | Mission pages (HTML) | `blueorigin.com/missions/...` | ⚠️ | ⚠️ | Useful, but automated fetch may be blocked by anti-bot checkpoint. |

## Observations from production data (next 30 days)

- In the current “now-24h → now+30d” window, LL2 links were only present for SpaceX and Isar Aerospace.
- Many providers in the window have **no** `launch_info_urls` / `mission_info_urls` in LL2, so we cannot rely on LL2 links alone for discovery.
- As of 2026-01-19, the orbit ingest job is successfully fetching and versioning docs, but the in-window candidates were SpaceX `/launches/...` pages + an Isar mission page (no numeric orbit params), so `target_orbit` constraints were not upserted yet.

## Source catalog (by organization)

### NASA / JPL (US) — *mission press kits (variable for numeric orbit params)*

**Why it’s good**
- NASA press kits frequently include detailed mission/launch timelines and “mission profile / flight profile” sections.
- For some missions, the press kit or partner-agency kit can contain target orbit/inclination or injection details.

**Where it lives (common patterns)**
- Press kit landing pages on `nasa.gov`:
  - `https://www.nasa.gov/<mission>-press-kit/`
- PDFs often in WordPress uploads:
  - `https://www.nasa.gov/wp-content/uploads/<YYYY>/<MM>/<...>.pdf`
  - some legacy/static paths also exist under `wp-content/uploads/static/...`
- Science mission kits can be hosted on `science.nasa.gov` under `wp-content/uploads/...`
- JPL press kits are commonly linked from `jpl.nasa.gov` press kit pages.

**Examples**
```text
https://www.nasa.gov/artemis-i-press-kit/
https://www.nasa.gov/wp-content/uploads/static/artemis-i-press-kit/img/Artemis%20I_Press%20Kit.pdf
https://www.nasa.gov/wp-content/uploads/2024/01/np-2023-12-016-jsc-clps-im-press-kit-web-508.pdf
https://science.nasa.gov/wp-content/uploads/2024/09/europa-clipper-press-kit.pdf
```

**Parser notes**
- NASA kits are not guaranteed to include explicit “inclination/azimuth” strings; treat them as a high-quality *context/timeline* source and a *sometimes* source for orbit numbers.

---

### ISRO (India) — *highest value (inclination + launch azimuth)*

**Why it’s good**
- Mission brochures often include a payload/orbit table with *both* **Inclination (deg)** and **Launch Azimuth (deg)**.

**Where it lives**
- PDFs hosted under `isro.gov.in` in predictable “Missions” folders.

**URL patterns**
- `https://www.isro.gov.in/media_isro/pdf/Missions/<MISSION_CODE>/<BROCHURE>.pdf`

**Example**
```text
https://www.isro.gov.in/media_isro/pdf/Missions/PSLVC54/PSLVC54_EOS6_BrochureV4.pdf
```

**Text patterns observed (works well with PDF text extraction)**
- `Inclination (deg) 98.341`
- `Launch Azimuth (deg) 140`
- `Altitude (km) ...`

**Parser notes**
- This format often uses `(deg)` / `(km)` *instead of* “degrees” / “km” in prose.
- Regex should support both “Inclination: 98°” and “Inclination (deg) 98.341”.

---

### Arianespace — *high value (inclination reliably present)*

**Why it’s good**
- “Launch Kit” PDFs commonly state the target orbit and **Inclination** clearly.

**Where it lives**
- Launch kit landing pages on `newsroom.arianespace.com` with an internal download handler.

**URL patterns**
- Landing page (per mission): `https://newsroom.arianespace.com/<slug>`
- Download endpoint: `https://newsroom.arianespace.com/download/?n=<hash>.pdf&id=<id>`

**Example**
```text
https://newsroom.arianespace.com/vega-c-flight-vv26
https://newsroom.arianespace.com/download/?n=d5bd8b1abfa5dcd7cfba667b503026ec.pdf&id=45398
```

**Text patterns observed**
- `Inclination: 98 °`
- `Sun-synchronous orbit (SSO)`

**Parser notes**
- Often enough to parse inclination + orbit class; azimuth is usually absent.

---

### ArianeGroup (Europe) — *high value (orbit + inclination wording varies)*

**Why it’s good**
- Launch kit PDFs are very pattern-friendly by URL, and often include target orbit parameters and mission duration.

**Where it lives**
- Often hosted at `ariane.group/app/uploads/YYYY/MM/LAUNCH-KIT-....pdf`

**Example**
```text
https://ariane.group/app/uploads/2025/12/LAUNCH-KIT-VA266-EN_FINAL.pdf
```

**Text patterns observed**
- `54 ° of inclination` (number before the word “inclination”)

**Parser notes**
- Support both `Inclination: 98°` and `54° of inclination` variants.

---

### United Launch Alliance (ULA) — *medium/high value (variable by mission)*

**Why it’s good**
- ULA mission pages sometimes link “Mission Overview” / “MOB” PDFs hosted on `ulalaunch.com`.
- When present, these PDFs can include orbit/injection details (varies by mission class).

**Where it lives**
- Mission pages: `ulalaunch.com/missions/...`
- PDFs linked from mission pages, commonly under:
  - `https://www.ulalaunch.com/docs/default-source/launch-booklets/...pdf`
  - (also older/other Sitefinity folders under `docs/default-source/...`)

**Example (mission page → PDF link)**
```text
https://www.ulalaunch.com/missions/archived-launched/atlas-v-mars-2020
https://www.ulalaunch.com/docs/default-source/launch-booklets/mars2020_mobrochure_200717.pdf
```

**Parser notes**
- Discovery should treat the mission page as an index and pull the PDF URLs out of the HTML.
- Orbit wording varies widely:
  - “hyperbolic escape orbit” (interplanetary)
  - tables with `(deg)` / `(km)` fields
  - prose “inclination … degrees”

---

### SpaceX — *good discovery; weak numeric orbit data*

**Why it’s good**
- Official mission data is fetchable via SpaceX’s content API (no JS rendering required).

**What’s missing**
- Many missions (especially Starlink) do **not** publish numeric orbit parameters (inclination/azimuth) in the mission JSON.
- Some missions link out to images/infographics; those are not easily parseable for numbers without OCR.

**Where it lives**
- Launch page (JS app): `https://www.spacex.com/launches/<slug>`
- Mission JSON API: `https://content.spacex.com/api/spacex-website/missions/<slug>`
- Assets CDN: `https://sxcontent9668.azureedge.us/cms-assets/assets/...`
- Starlink public files (PDFs): `https://starlink.com/public-files/...`

**What we do in `trajectory-orbit-ingest`**
- If LL2 links a SpaceX launch page (`spacex.com/launches/<slug>`), the ingest job rewrites it to the mission JSON API URL for fetching/extraction.
- For Starlink missions, we also try a small set of official Starlink public PDFs (in addition to the mission JSON) to capture any published injection/orbit numbers.
- Caveat: upcoming missions may not have a published mission JSON yet (404). In that case, we still cache what we can and rely on derived fallbacks for numeric orbit params (see below).

**Derived fallbacks (SpaceX-specific)**
- For certain SpaceX mission families where public mission docs are sparse, we add a low/medium-confidence `target_orbit` constraint using static heuristics:
  - Starlink from Cape (SLC-40): default `inclination≈43°`, `altitude≈530 km`
  - Starlink from Vandenberg (SLC-4E): default `inclination≈70°`, `altitude≈570 km`
  - Crew/ISS family: default `inclination≈51.6°`, `altitude≈400 km`
  - GPS family: default `inclination≈55°`, `altitude≈20,200 km` (`orbit_class=MEO`)

**High-confidence numeric azimuth (when available)**
- If we already have matched NAVCEN BNM hazard polygons for a launch (`constraint_type='hazard_area'`, `source='navcen_bnm'`), we derive a high-confidence `flight_azimuth_deg` and upsert it as a `target_orbit` constraint (`source='navcen_bnm'`, `orbitType='hazard_azimuth_estimate'`).

**Example**
```text
https://www.spacex.com/launches/sl-6-100
https://content.spacex.com/api/spacex-website/missions/sl-6-100
```

**Parser notes**
- Still useful to parse `orbit_class` from phrases like “low-Earth orbit” / “International Space Station”, but don’t expect numeric inclination/azimuth.
- If we decide numeric orbit is required for SpaceX, we likely need a different gold source (e.g., partner agency press kit, FCC filing, etc.).

**Also useful (vehicle user guides)**
- Falcon user guide PDFs contain representative mission profiles and performance/inclination envelopes (not mission-specific), and are stable to track by versioned filename:
```text
https://www.spacex.com/assets/media/falcon-users-guide-2025-05-09.pdf
```

**Common “archive” sources (fallback, not official)**
- SpaceX sometimes removes older press kits; reputable archives are commonly used for historical kits:
```text
https://www.elonx.net/documents/
https://spaceflightnow.com/falcon9/003/spacex_presskit.pdf
https://spaceflightnow.com/falcon9/002/cots1_presskit.pdf
```

---

### Isar Aerospace — *unknown / needs confirmation per mission*

**Why it might be good**
- They publish press-kit PDFs for some missions/events.

**Known example (press kit PDF)**
```text
https://www.isaraerospace.com/images/Isar-Aerospace-F1-Going-Full-Spectrum-Press-Kit.pdf
```

**Open questions**
- Do upcoming mission pages link a mission-specific kit with orbit parameters?
- If not linked, is there a stable “press downloads” index or sitemap we can crawl?

---

### Rocket Lab — *mixed; needs updated mapping for mission-specific kits*

**Current state**
- The `rocketlabcorp.com` site hosts some “Press Kit” pages that link PDFs under `/assets/Uploads/...pdf`.
- Older “test flight” kits exist and are fetchable; mission-specific kits for modern launches need validation (some legacy `rocketlabusa.com/assets/Uploads/...` links now redirect and/or 404).

**Example (page → PDF)**
```text
https://rocketlabcorp.com/updates/still-testing-press-kit/
https://rocketlabcorp.com/assets/Uploads/MED17-003-Launch-Media-Kit-Flight-two-StillTesting-2.pdf
```

**Parser notes**
- Some kits are company/vehicle focused and may not include target orbit numbers.
- If we use Rocket Lab as a gold source, we should build discovery from their sitemap + per-mission press-kit pages, not hardcoded PDF URLs.
- Some mission press kits embed key orbit parameters in a front-page “mission card” layout that may not be fully extractable as text (may require OCR for the numeric inclination).

**Examples (recent mission press kits; PDFs)**
```text
https://rocketlabcorp.com/assets/Uploads/RL-ESCAPADE-Press-Kit-2025.pdf
https://rocketlabcorp.com/assets/Uploads/F64-iQPS-Presskit-The-Sea-God-Sees.pdf
https://rocketlabcorp.com/assets/Uploads/RL-F74-The-Nation-God-Navigates-Presskit.pdf
https://rocketlabcorp.com/assets/Uploads/F73-Press-Kit-Owl-New-World.pdf
```

---

### JAXA (Japan) — *high value (press kits / countdown media kits)*

**Why it’s good**
- JAXA countdown/media kit PDFs can include explicit flight path / mission profile details.

**Examples**
```text
https://global.jaxa.jp/countdown/slim/SLIM-mediakit-EN_2310.pdf
https://humans-in-space.jaxa.jp/htv/mission/htv-x1/presskit/JAXA_htv-x1_presskit.pdf
```

---

### ESA (Europe) — *good value (launch/media kits; often HTML + PDFs)*

**Why it’s good**
- ESA launch kits / media kits frequently include trajectory context and mission timeline.

**Examples**
```text
https://www.esa.int/Science_Exploration/Space_Science/Juice/Juice_launch_kit
https://www.esa.int/Science_Exploration/Space_Science/Solar_Orbiter/Solar_Orbiter_launch_media_kit
https://historicalarchives.esa.int/ariane-press-kits
```

---

### Firefly Aerospace — *user guide (generic capability, not mission-specific)*

**Example**
```text
https://fireflyspace.com/wp-content/uploads/2025/07/Alpha-PUG-5.2.pdf
```

---

### Northrop Grumman / Antares — *user guide (generic capability, not mission-specific)*

**Example**
```text
https://cdn.northropgrumman.com/-/media/Project/Northrop-Grumman/ngc/space/antares/Antares-Users-Guide.pdf
```

---

### Blue Origin — *likely useful, but access may be blocked*

**Notes**
- Blue Origin mission pages can contain flight profile graphics and text, but automated fetch may be blocked (observed “Vercel Security Checkpoint” / 429/403 responses).

**Examples**
```text
https://www.blueorigin.com/missions/ng-1
https://www.blueorigin.com/missions/ng-2
https://www.blueorigin.com/new-glenn
```

---

### Rocket Factory Augsburg (RFA) — *press kit page (may be request-gated)*

**Example**
```text
https://www.rfa.space/presskit/
```

## Recommended discovery strategy (pragmatic)

1) **Start with LL2 URLs when present** (`launch_info_urls`, `mission_info_urls`).
2) **Host-specific “expansion”**
   - If the candidate URL is a mission page (ULA/Arianespace/etc.), parse the page to extract linked PDFs.
   - If the candidate URL is a SpaceX launch page, derive the mission JSON API URL and treat that as a doc.
3) **Provider/agency fallback discovery when LL2 has no URLs**
   - ISRO: crawl `isro.gov.in/media_isro/pdf/Missions/...` via known mission code sources (needs a resolver; LL2 alone may not provide it).
   - Arianespace: use `newsroom.arianespace.com` launch kit slugs (needs a resolver; could be built from launch name + date + web search as a last resort).
   - Rocket Lab: use `rocketlabcorp.com` sitemap to locate press-kit pages, then map to a specific launch.

## Recommended “truth” domains (starting point)

If we keep “truth vs fallback” scoring:

- Truth candidates worth adding:
  - `spacex.com`, `content.spacex.com`, `sxcontent9668.azureedge.us`
  - `arianespace.com` (covers `newsroom.arianespace.com`)
  - `ariane.group`
  - `isro.gov.in`
  - `rocketlabcorp.com` (and/or `rocketlabusa.com`)
  - `isaraerospace.com`
  - `global.jaxa.jp`, `humans-in-space.jaxa.jp`
  - `fireflyspace.com`
  - `cdn.northropgrumman.com`

Fallback candidates worth adding:
- `.gov.in` (and possibly other country gov TLDs as needed)

## URL regex patterns (for harvesting)

These are useful if we implement sitemap crawlers or an external search-backed “new drop” finder:

```regex
# NASA press-kit PDFs (wp-content uploads; often contains "press-kit" and sometimes "web-508")
^https?://(?:www\\.)?nasa\\.gov/wp-content/uploads/\\d{4}/\\d{2}/.*(?:press|media)[-_ ]?kit.*\\.pdf(?:\\?.*)?$

# ULA PDFs (launch booklets + news items + rockets)
^https?://(?:www\\.)?ulalaunch\\.com/docs/default-source/(?:launch-booklets|news-items|rockets)/.*\\.pdf(?:\\?.*)?$

# Rocket Lab press kits
^https?://rocketlabcorp\\.com/assets/Uploads/.*(?:Press[-_ ]?Kit|Presskit).*\\.pdf(?:\\?.*)?$

# ArianeGroup launch kits
^https?://ariane\\.group/app/uploads/\\d{4}/\\d{2}/LAUNCH-KIT-.*\\.pdf(?:\\?.*)?$

# SpaceX Falcon users guide (public, consistent path)
^https?://(?:www\\.)?spacex\\.com/assets/media/.*(?:users[-_ ]?guide|user[-_ ]?guide).*\\.pdf(?:\\?.*)?$

# ISRO PDFs
^https?://(?:www\\.)?isro\\.gov\\.in/media_isro/pdf/.+\\.pdf(?:\\?.*)?$

# JAXA PDFs (broad catch; filter by keywords)
^https?://(?:global|humans-in-space)\\.jaxa\\.jp/.+\\.pdf(?:\\?.*)?$

# Firefly (WordPress-hosted)
^https?://(?:www\\.)?fireflyspace\\.com/wp-content/uploads/\\d{4}/\\d{2}/.*\\.pdf(?:\\?.*)?$
```

## Next implementation steps

1) Add a “source registry” (host/pattern → discovery + parser) instead of relying on generic regex + domain list.
2) Extend orbit parsing to support table-style fields:
   - `Inclination (deg) 98.341`
   - `Launch Azimuth (deg) 140`
   - `Altitude (km) 550`
3) Build per-provider discovery where LL2 links are missing (starting with the highest-value providers in our upcoming window).
