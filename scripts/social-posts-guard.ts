import fs from 'node:fs';
import path from 'node:path';

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string) {
  if (!condition) fail(message);
}

function main() {
  const filePath = path.join(process.cwd(), 'supabase/functions/social-posts-dispatch/index.ts');
  const text = fs.readFileSync(filePath, 'utf8');

  assert(text.includes('on_this_day_date_local'), 'Expected `on_this_day_date_local` token to exist.');
  assert(
    !text.includes('On this day in {on_this_day_year}'),
    'Expected ON_THIS_DAY templates to avoid year-only headers.'
  );
  assert(
    text.includes('shouldExcludeOnThisDayLaunchForNoLaunchDay'),
    'Expected no-launch-day rendering to exclude current-year on-this-day launches.'
  );
  assert(
    !text.includes('social_posts_launch_day_url_followup_enabled'),
    'Expected launch-day URL followup setting to be removed; social posts should not publish URLs.'
  );
  assert(!text.includes('REPLY_TEMPLATES'), 'Expected URL reply templates (REPLY_TEMPLATES) to be removed.');
  assert(!text.includes('Link in reply ↓'), 'Expected launch-day templates to avoid "Link in reply" lines.');
  assert(
    text.includes('stripUrlsFromText(text)'),
    'Expected social post sender to scrub URLs from outgoing text.'
  );
  assert(text.includes('social_posts_x_max_chars'), 'Expected configurable X max chars setting to exist.');
  assert(text.includes('thread_segment_index'), 'Expected thread_segment_index support in social_posts pipeline.');
  assert(text.includes('reply_to_social_post_id'), 'Expected reply_to_social_post_id support in social_posts pipeline.');
  assert(
    text.includes('splitXThreadChunksWithLabels'),
    'Expected X long posts to split into labeled thread chunks.'
  );

  console.log('social-posts-dispatch guard passed');
}

main();
