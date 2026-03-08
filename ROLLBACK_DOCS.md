# Rollback Documentation - Commit Date: 2026-01-11

## Summary of Changes

This commit includes major enhancements to URL slugs, cron job scheduling, admin features, and UI improvements across the application.

## Key Changes

### 1. Database Migrations (CRITICAL)

#### Migration 0063: Scheduler Cron 15-minute Interval
**File**: `supabase/migrations/0063_scheduler_cron_15min.sql`

**What it does**:
- Creates `get_cron_jobs()` function for admin access to cron job schedules
- Changes `ingestion_cycle` cron from previous interval to **every 15 minutes** (`*/15 * * * *`)
- Changes `monitoring_check` cron to **every 5 minutes** (`*/5 * * * *`)

**Rollback**:
```sql
-- To revert cron schedules to previous intervals
-- (Adjust timing as needed based on previous configuration)
SELECT cron.unschedule('ingestion_cycle');
SELECT cron.schedule('ingestion_cycle', '*/30 * * * *', $$SELECT public.invoke_edge_job('ingestion-cycle');$$);

SELECT cron.unschedule('monitoring_check');
SELECT cron.schedule('monitoring_check', '*/10 * * * *', $$SELECT public.invoke_edge_job('monitoring-check');$$);

-- To remove the get_cron_jobs function
DROP FUNCTION IF EXISTS public.get_cron_jobs(text[]);
```

#### Migration 0064: Launches Public Cache Slug
**File**: `supabase/migrations/0064_launches_public_cache_slug.sql`

**What it does**:
- Adds `slug` column to `launches_public_cache` table

**Rollback**:
```sql
ALTER TABLE public.launches_public_cache DROP COLUMN IF EXISTS slug;
```

### 2. New Utilities

#### Slug Generation
**Files**:
- `lib/utils/slug.ts` - New slug generation utilities
- Updated: `lib/ingestion/publicCache.ts`, `lib/server/transformers.ts` to generate slugs

**What it does**:
- Provides `slugify()` and `buildSlugId()` functions for creating URL-friendly slugs
- Slugs are auto-generated from launch names with IDs appended

**Rollback**: Remove slug usage from code, revert to using only IDs in URLs

#### Launch Feed Constants
**File**: `lib/constants/launchFeed.ts`

**What it does**:
- Centralizes launch feed page size (12 items per page)

**Rollback**: Delete file, hard-code page size value back into components

#### Home Launch Feed
**File**: `lib/server/homeLaunchFeed.ts`

**What it does**:
- Extracts home page launch feed logic into reusable server function

**Rollback**: Move logic back inline to `app/page.tsx`

### 3. Major Component Updates

#### Admin Page Enhancements
**File**: `app/admin/page.tsx` (+117 insertions, -3 deletions)

**What it does**:
- Adds cron job monitoring
- Enhanced system health dashboard
- More detailed summary statistics

**Impact**: Admin-only, low risk to production users

#### Launch Feed Improvements
**File**: `components/LaunchFeed.tsx` (+81 insertions, -6 deletions)

**What it does**:
- Better pagination handling
- Improved loading states
- Enhanced error handling

**Impact**: Medium - affects main launch listing

#### Launch Links with Slugs
**File**: `lib/utils/launchLinks.ts` (+30 insertions, -2 deletions)

**What it does**:
- Launch URLs now use slugs: `/launches/falcon-9-starlink-abc123` instead of `/launches/abc123`
- Backward compatible (still accepts ID-only URLs)

**Impact**: HIGH - changes URL structure for launches

### 4. Time Utilities
**File**: `lib/time.ts` (+9 insertions, -1 deletion)

**What it does**:
- Enhanced time formatting utilities
- Better handling of edge cases

**Impact**: Low - utility improvements

### 5. Weather Forecast Ingestion
**File**: `lib/server/ws45ForecastIngest.ts` (+57 insertions, -4 deletions)

**What it does**:
- Improved weather forecast data parsing
- Better error handling for missing data

**Impact**: Low - backend data ingestion

## Rollback Strategy

### Quick Rollback (Git Revert)
```bash
# If issues are discovered, revert this commit
git revert <commit-hash>
git push origin main
```

### Database-Only Rollback
If you only need to rollback database changes:

```bash
# Run rollback SQL commands (see above in Migration sections)
# Then update code to not use new columns
```

### Partial Rollback - URL Slugs Only
If slug URLs are causing issues but everything else is fine:

1. Revert these files:
   - `lib/utils/slug.ts` (delete)
   - `lib/utils/launchLinks.ts`
   - `lib/ingestion/publicCache.ts`
   - `lib/server/transformers.ts`
   - `supabase/migrations/0064_launches_public_cache_slug.sql`

2. Run SQL:
```sql
ALTER TABLE public.launches_public_cache DROP COLUMN IF EXISTS slug;
```

### Partial Rollback - Cron Schedule Only
If 15-minute ingestion is too frequent:

```sql
-- Revert to 30 minutes (or previous interval)
SELECT cron.unschedule('ingestion_cycle');
SELECT cron.schedule('ingestion_cycle', '*/30 * * * *', $$SELECT public.invoke_edge_job('ingestion-cycle');$$);
```

## Testing Checklist Post-Rollback

If you rollback, verify:
- [ ] Launch detail pages load correctly
- [ ] Launch URLs work (both old and new format if partial rollback)
- [ ] Home page launch feed displays
- [ ] Admin dashboard loads
- [ ] Calendar exports work
- [ ] Cron jobs are running on expected schedule
- [ ] Public cache is updating

## Files Changed (30 total)

**Modified**: 30 files (732 insertions, 187 deletions)
**New files**: 4 files
- `lib/constants/launchFeed.ts`
- `lib/server/homeLaunchFeed.ts`
- `lib/utils/slug.ts`
- `supabase/migrations/0063_scheduler_cron_15min.sql`
- `supabase/migrations/0064_launches_public_cache_slug.sql`

## Risk Assessment

**HIGH RISK**:
- Cron schedule changes (could affect data freshness)
- URL slug implementation (could break existing links)

**MEDIUM RISK**:
- LaunchFeed component changes
- Admin page changes

**LOW RISK**:
- Utility function improvements
- Constants extraction
- Code organization improvements

## Notes

- All URL changes should be backward compatible (old ID-only URLs still work)
- Cron schedule changes increase API call frequency to Launch Library 2
- Slug generation happens during cache regeneration
- No user data is affected by these changes
