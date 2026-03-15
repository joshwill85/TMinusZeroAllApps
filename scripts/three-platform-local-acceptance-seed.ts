import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';
import {
  LOCAL_ACCEPTANCE_IDS,
  LOCAL_ACCEPTANCE_LAUNCHES,
  LOCAL_ACCEPTANCE_USERS
} from './three-platform-local-fixture';
import { ensureLocalSupabaseStarted } from './three-platform-local-stack';

type SeedArtifact = {
  generatedAt: string;
  users: {
    free: { userId: string; email: string };
    premium: { userId: string; email: string };
  };
  launches: Array<{ id: string; name: string }>;
  watchlist: { id: string };
  filterPreset: { id: string };
};

type FixtureUser = (typeof LOCAL_ACCEPTANCE_USERS)[keyof typeof LOCAL_ACCEPTANCE_USERS];

const { values } = parseArgs({
  options: {
    out: { type: 'string' },
    help: { type: 'boolean', short: 'h' }
  }
});

function writeJson(filePath: string, value: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function ensureAuthUser(
  admin: ReturnType<typeof createClient>,
  fixture: FixtureUser
) {
  const { data: listed, error: listError } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 200
  });
  if (listError) {
    throw listError;
  }

  const existing =
    listed.users.find((user) => String(user.email || '').trim().toLowerCase() === fixture.email.toLowerCase()) ?? null;

  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      email: fixture.email,
      password: fixture.password,
      email_confirm: true,
      user_metadata: {
        first_name: fixture.firstName,
        last_name: fixture.lastName
      },
      app_metadata: {
        role: 'member'
      }
    });
    if (error || !data.user) {
      throw error ?? new Error(`Unable to update auth user for ${fixture.email}.`);
    }
    return data.user;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: fixture.email,
    password: fixture.password,
    email_confirm: true,
    user_metadata: {
      first_name: fixture.firstName,
      last_name: fixture.lastName
    },
    app_metadata: {
      role: 'member'
    }
  });
  if (error || !data.user) {
    throw error ?? new Error(`Unable to create auth user for ${fixture.email}.`);
  }
  return data.user;
}

async function main() {
  if (values.help) {
    console.log('Usage: npm run seed:three-platform:local -- --out=.artifacts/three-platform-local-acceptance/seed.json');
    process.exit(0);
  }

  const status = ensureLocalSupabaseStarted();
  const admin = createClient(status.API_URL, status.SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });

  const db = new Client({
    connectionString: status.DB_URL
  });

  await db.connect();

  try {
    const [freeUser, premiumUser] = await Promise.all([
      ensureAuthUser(admin, LOCAL_ACCEPTANCE_USERS.free),
      ensureAuthUser(admin, LOCAL_ACCEPTANCE_USERS.premium)
    ]);

    const premiumPeriodEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();

    await db.query('begin');

    await db.query(
      `
      insert into public.profiles (user_id, email, role, first_name, last_name, timezone, created_at, updated_at)
      values
        ($1, $2, 'user', $3, $4, $5, timezone('utc', now()), timezone('utc', now())),
        ($6, $7, 'user', $8, $9, $10, timezone('utc', now()), timezone('utc', now()))
      on conflict (user_id) do update
      set
        email = excluded.email,
        role = excluded.role,
        first_name = excluded.first_name,
        last_name = excluded.last_name,
        timezone = excluded.timezone,
        updated_at = timezone('utc', now())
      `,
      [
        freeUser.id,
        LOCAL_ACCEPTANCE_USERS.free.email,
        LOCAL_ACCEPTANCE_USERS.free.firstName,
        LOCAL_ACCEPTANCE_USERS.free.lastName,
        LOCAL_ACCEPTANCE_USERS.free.timezone,
        premiumUser.id,
        LOCAL_ACCEPTANCE_USERS.premium.email,
        LOCAL_ACCEPTANCE_USERS.premium.firstName,
        LOCAL_ACCEPTANCE_USERS.premium.lastName,
        LOCAL_ACCEPTANCE_USERS.premium.timezone
      ]
    );

    await db.query('delete from public.notification_push_devices where user_id = any($1::uuid[])', [[freeUser.id, premiumUser.id]]);
    await db.query('delete from public.purchase_events where user_id = any($1::uuid[])', [[freeUser.id, premiumUser.id]]);
    await db.query('delete from public.purchase_entitlements where user_id = any($1::uuid[])', [[freeUser.id, premiumUser.id]]);
    await db.query('delete from public.purchase_provider_customers where user_id = any($1::uuid[])', [[freeUser.id, premiumUser.id]]);
    await db.query('delete from public.subscriptions where user_id = any($1::uuid[])', [[freeUser.id, premiumUser.id]]);
    await db.query('delete from public.stripe_customers where user_id = any($1::uuid[])', [[freeUser.id, premiumUser.id]]);
    await db.query('delete from public.watchlist_rules where watchlist_id = $1::uuid', [LOCAL_ACCEPTANCE_IDS.premiumWatchlistId]);
    await db.query('delete from public.watchlists where id = $1::uuid', [LOCAL_ACCEPTANCE_IDS.premiumWatchlistId]);
    await db.query('delete from public.launch_filter_presets where id = $1::uuid', [LOCAL_ACCEPTANCE_IDS.premiumFilterPresetId]);
    await db.query(
      'delete from public.launches_public_cache where launch_id = any($1::uuid[])',
      [LOCAL_ACCEPTANCE_LAUNCHES.map((launch) => launch.id)]
    );

    await db.query(
      `
      insert into public.notification_preferences (
        user_id,
        push_enabled,
        email_enabled,
        sms_enabled,
        launch_day_email_enabled,
        launch_day_email_providers,
        launch_day_email_states,
        quiet_hours_enabled,
        quiet_start_local,
        quiet_end_local,
        sms_verified,
        sms_phone_e164,
        updated_at
      )
      values
        ($1, false, true, false, false, '{}'::text[], '{}'::text[], false, null, null, false, null, timezone('utc', now())),
        ($2, false, true, false, false, '{}'::text[], '{}'::text[], false, null, null, false, null, timezone('utc', now()))
      on conflict (user_id) do update
      set
        push_enabled = excluded.push_enabled,
        email_enabled = excluded.email_enabled,
        sms_enabled = excluded.sms_enabled,
        launch_day_email_enabled = excluded.launch_day_email_enabled,
        launch_day_email_providers = excluded.launch_day_email_providers,
        launch_day_email_states = excluded.launch_day_email_states,
        quiet_hours_enabled = excluded.quiet_hours_enabled,
        quiet_start_local = excluded.quiet_start_local,
        quiet_end_local = excluded.quiet_end_local,
        sms_verified = excluded.sms_verified,
        sms_phone_e164 = excluded.sms_phone_e164,
        updated_at = timezone('utc', now())
      `,
      [freeUser.id, premiumUser.id]
    );

    await db.query(
      `
      insert into public.privacy_preferences (
        user_id,
        opt_out_sale_share,
        opt_out_targeted_ads,
        limit_sensitive,
        block_third_party_embeds,
        gpc_enabled,
        updated_at
      )
      values
        ($1, false, false, false, false, false, timezone('utc', now())),
        ($2, false, false, false, false, false, timezone('utc', now()))
      on conflict (user_id) do update
      set
        opt_out_sale_share = excluded.opt_out_sale_share,
        opt_out_targeted_ads = excluded.opt_out_targeted_ads,
        limit_sensitive = excluded.limit_sensitive,
        block_third_party_embeds = excluded.block_third_party_embeds,
        gpc_enabled = excluded.gpc_enabled,
        updated_at = timezone('utc', now())
      `,
      [freeUser.id, premiumUser.id]
    );

    await db.query(
      `
      insert into public.watchlists (id, user_id, name, created_at, updated_at)
      values ($1, $2, 'My Launches', timezone('utc', now()), timezone('utc', now()))
      `,
      [LOCAL_ACCEPTANCE_IDS.premiumWatchlistId, premiumUser.id]
    );

    await db.query(
      `
      insert into public.watchlist_rules (id, watchlist_id, rule_type, rule_value, created_at)
      values ($1, $2, 'provider', 'SpaceX', timezone('utc', now()))
      `,
      [LOCAL_ACCEPTANCE_IDS.premiumWatchlistRuleId, LOCAL_ACCEPTANCE_IDS.premiumWatchlistId]
    );

    await db.query(
      `
      insert into public.launch_filter_presets (id, user_id, name, filters, is_default, created_at, updated_at)
      values ($1, $2, 'SpaceX Feed', '{"provider":"SpaceX","sort":"soonest"}'::jsonb, true, timezone('utc', now()), timezone('utc', now()))
      `,
      [LOCAL_ACCEPTANCE_IDS.premiumFilterPresetId, premiumUser.id]
    );

    for (const launch of LOCAL_ACCEPTANCE_LAUNCHES) {
      await db.query(
        `
        insert into public.launches_public_cache (
          launch_id,
          ll2_launch_uuid,
          name,
          slug,
          provider,
          vehicle,
          rocket_full_name,
          mission_name,
          mission_description,
          net,
          net_precision,
          status_name,
          status_abbrev,
          tier,
          featured,
          hidden,
          pad_name,
          pad_short_code,
          pad_state_code,
          pad_state,
          pad_timezone,
          location_name,
          pad_location_name,
          pad_country_code,
          image_thumbnail_url,
          webcast_live,
          cache_generated_at
        )
        values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12, $13, $14, $15, false, $16, $17,
          $18, $19, $20, $21, $22, $23, $24, false, timezone('utc', now())
        )
        on conflict (launch_id) do update
        set
          ll2_launch_uuid = excluded.ll2_launch_uuid,
          name = excluded.name,
          slug = excluded.slug,
          provider = excluded.provider,
          vehicle = excluded.vehicle,
          rocket_full_name = excluded.rocket_full_name,
          mission_name = excluded.mission_name,
          mission_description = excluded.mission_description,
          net = excluded.net,
          net_precision = excluded.net_precision,
          status_name = excluded.status_name,
          status_abbrev = excluded.status_abbrev,
          tier = excluded.tier,
          featured = excluded.featured,
          hidden = excluded.hidden,
          pad_name = excluded.pad_name,
          pad_short_code = excluded.pad_short_code,
          pad_state_code = excluded.pad_state_code,
          pad_state = excluded.pad_state,
          pad_timezone = excluded.pad_timezone,
          location_name = excluded.location_name,
          pad_location_name = excluded.pad_location_name,
          pad_country_code = excluded.pad_country_code,
          image_thumbnail_url = excluded.image_thumbnail_url,
          webcast_live = excluded.webcast_live,
          cache_generated_at = timezone('utc', now())
        `,
        [
          launch.id,
          launch.ll2LaunchUuid,
          launch.name,
          launch.slug,
          launch.provider,
          launch.vehicle,
          launch.rocketFullName,
          launch.missionName,
          launch.missionDescription,
          launch.net,
          launch.netPrecision,
          launch.statusName,
          launch.statusAbbrev,
          launch.tier,
          launch.featured,
          launch.padName,
          launch.padShortCode,
          launch.padStateCode,
          launch.padState,
          launch.padTimezone,
          launch.padLocationName,
          launch.padLocationName,
          launch.padCountryCode,
          launch.imageThumbnailUrl
        ]
      );
    }

    await db.query(
      `
      insert into public.stripe_customers (user_id, stripe_customer_id, created_at)
      values ($1, 'cus_local_acceptance_premium', timezone('utc', now()))
      `,
      [premiumUser.id]
    );

    await db.query(
      `
      insert into public.subscriptions (
        user_id,
        stripe_subscription_id,
        stripe_price_id,
        status,
        current_period_end,
        cancel_at_period_end,
        created_at,
        updated_at
      )
      values ($1, 'sub_local_acceptance_premium', 'price_local_acceptance_premium', 'active', $2, false, timezone('utc', now()), timezone('utc', now()))
      `,
      [premiumUser.id, premiumPeriodEnd]
    );

    await db.query(
      `
      insert into public.purchase_provider_customers (user_id, provider, provider_customer_id, metadata, created_at, updated_at)
      values ($1, 'stripe', 'cus_local_acceptance_premium', '{"source":"local_seed"}'::jsonb, timezone('utc', now()), timezone('utc', now()))
      `,
      [premiumUser.id]
    );

    await db.query(
      `
      insert into public.purchase_entitlements (
        user_id,
        entitlement_key,
        provider,
        provider_subscription_id,
        provider_product_id,
        status,
        is_active,
        cancel_at_period_end,
        current_period_end,
        source,
        metadata,
        created_at,
        updated_at
      )
      values (
        $1,
        'premium',
        'stripe',
        'sub_local_acceptance_premium',
        'price_local_acceptance_premium',
        'active',
        true,
        false,
        $2,
        'manual',
        '{"seed":"three-platform-local-acceptance"}'::jsonb,
        timezone('utc', now()),
        timezone('utc', now())
      )
      `,
      [premiumUser.id, premiumPeriodEnd]
    );

    await db.query(
      `
      insert into public.purchase_events (
        user_id,
        provider,
        entitlement_key,
        event_type,
        provider_event_id,
        provider_subscription_id,
        provider_product_id,
        status,
        payload,
        created_at
      )
      values (
        $1,
        'stripe',
        'premium',
        'local_seed',
        'evt_local_acceptance_seed',
        'sub_local_acceptance_premium',
        'price_local_acceptance_premium',
        'active',
        '{"source":"three-platform-local-acceptance"}'::jsonb,
        timezone('utc', now())
      )
      `,
      [premiumUser.id]
    );

    await db.query('commit');

    await db.query('select public.refresh_search_documents_db_sources()');

    const artifact: SeedArtifact = {
      generatedAt: nowIso,
      users: {
        free: {
          userId: freeUser.id,
          email: LOCAL_ACCEPTANCE_USERS.free.email
        },
        premium: {
          userId: premiumUser.id,
          email: LOCAL_ACCEPTANCE_USERS.premium.email
        }
      },
      launches: LOCAL_ACCEPTANCE_LAUNCHES.map((launch) => ({
        id: launch.id,
        name: launch.name
      })),
      watchlist: {
        id: LOCAL_ACCEPTANCE_IDS.premiumWatchlistId
      },
      filterPreset: {
        id: LOCAL_ACCEPTANCE_IDS.premiumFilterPresetId
      }
    };

    const outPath = typeof values.out === 'string' && values.out.trim() ? values.out.trim() : null;
    if (outPath) {
      const resolved = path.isAbsolute(outPath) ? outPath : path.join(process.cwd(), outPath);
      writeJson(resolved, artifact);
      console.log(`three-platform-local-seed: wrote ${path.relative(process.cwd(), resolved)}`);
    } else {
      console.log(JSON.stringify(artifact, null, 2));
    }
  } catch (error) {
    await db.query('rollback').catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
