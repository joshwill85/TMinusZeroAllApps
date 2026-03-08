-- Unified low-IO public site search.
-- One denormalized corpus powers live suggestions and full results without
-- rebuilding snapshots on the query path.

create schema if not exists extensions;

do $$
declare
  ext_schema text;
begin
  select n.nspname
    into ext_schema
  from pg_extension e
  join pg_namespace n on n.oid = e.extnamespace
  where e.extname = 'pg_trgm';

  if ext_schema is null then
    create extension if not exists pg_trgm with schema extensions;
  elsif ext_schema <> 'extensions' then
    alter extension pg_trgm set schema extensions;
  end if;
end $$;

create or replace function public.search_normalize_text(value text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(both ' ' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', ' ', 'g'));
$$;

create or replace function public.search_slugify_text(value text, max_length integer default 64)
returns text
language sql
immutable
parallel safe
as $$
  select left(trim(both '-' from regexp_replace(lower(coalesce(value, '')), '[^a-z0-9]+', '-', 'g')), greatest(coalesce(max_length, 64), 1));
$$;

create or replace function public.search_build_launch_href(slug_source text, launch_id uuid)
returns text
language sql
immutable
parallel safe
as $$
  select '/launches/' || case
    when public.search_slugify_text(slug_source, 64) <> '' then public.search_slugify_text(slug_source, 64) || '-' || launch_id::text
    else launch_id::text
  end;
$$;

create or replace function public.search_websearch_to_tsquery(query_text text)
returns tsquery
language plpgsql
stable
parallel safe
as $$
begin
  if query_text is null or btrim(query_text) = '' then
    return null;
  end if;

  return websearch_to_tsquery('english', query_text);
exception
  when others then
    return null;
end;
$$;

create or replace function public.search_extract_query_terms(query_text text, include_negated boolean default false)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    trim(
      both ' '
      from coalesce(
        (
          select string_agg(token, ' ' order by ordinality)
          from (
            select match_parts[1] as token, ordinality
            from regexp_matches(coalesce(query_text, ''), $search_terms$(-?"[^"]+"|-?[^[:space:]]+)$search_terms$, 'g')
              with ordinality as matches(match_parts, ordinality)
          ) tokens
          where case
            when include_negated then left(token, 1) = '-' and btrim(substr(token, 2)) <> ''
            else left(token, 1) <> '-'
          end
        ),
        ''
      )
    ),
    ''
  );
$$;

create or replace function public.search_prefix_tsquery(query_text text)
returns tsquery
language plpgsql
stable
parallel safe
as $$
declare
  normalized text;
  tsquery_text text;
begin
  normalized := public.search_normalize_text(query_text);
  if normalized = '' then
    return null;
  end if;

  select string_agg(token || ':*', ' & ' order by ordinality)
    into tsquery_text
  from regexp_split_to_table(normalized, '\s+') with ordinality as t(token, ordinality)
  where token <> '';

  if tsquery_text is null or tsquery_text = '' then
    return null;
  end if;

  return to_tsquery('simple', tsquery_text);
exception
  when others then
    return null;
end;
$$;

create table if not exists public.search_documents (
  doc_id text primary key,
  source_type text not null,
  doc_type text not null check (doc_type in ('launch', 'hub', 'guide', 'news', 'contract', 'person', 'recovery', 'catalog', 'page')),
  url text not null,
  title text not null,
  subtitle text,
  summary text,
  body_preview text,
  aliases text[] not null default '{}'::text[],
  keywords text[] not null default '{}'::text[],
  badge text,
  image_url text,
  published_at timestamptz,
  source_updated_at timestamptz,
  boost double precision not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  content_hash text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title_alias_text text,
  search_vector tsvector
);

create or replace function public.search_documents_update_generated_fields()
returns trigger
language plpgsql
as $$
begin
  new.title_alias_text := left(
    public.search_normalize_text(
      concat_ws(
        ' ',
        new.title,
        new.subtitle,
        array_to_string(new.aliases, ' '),
        array_to_string(new.keywords, ' ')
      )
    ),
    512
  );

  new.search_vector := (
    setweight(to_tsvector('english', left(coalesce(new.title, ''), 256)), 'A') ||
    setweight(to_tsvector('english', left(coalesce(array_to_string(new.aliases, ' '), ''), 256)), 'A') ||
    setweight(to_tsvector('english', left(coalesce(new.subtitle, ''), 256)), 'B') ||
    setweight(to_tsvector('english', left(coalesce(new.summary, ''), 600)), 'B') ||
    setweight(to_tsvector('english', left(coalesce(array_to_string(new.keywords, ' '), ''), 400)), 'B') ||
    setweight(to_tsvector('english', left(coalesce(new.body_preview, ''), 1500)), 'C') ||
    setweight(to_tsvector('simple', left(coalesce(new.title, ''), 256)), 'A') ||
    setweight(to_tsvector('simple', left(coalesce(array_to_string(new.aliases, ' '), ''), 256)), 'A') ||
    setweight(to_tsvector('simple', left(coalesce(new.subtitle, ''), 256)), 'B') ||
    setweight(to_tsvector('simple', left(coalesce(array_to_string(new.keywords, ' '), ''), 400)), 'B')
  );

  return new;
end;
$$;

create trigger search_documents_set_generated_fields
  before insert or update on public.search_documents
  for each row
  execute function public.search_documents_update_generated_fields();

create index if not exists search_documents_source_type_idx
  on public.search_documents(source_type);

create index if not exists search_documents_doc_type_published_idx
  on public.search_documents(doc_type, published_at desc nulls last);

create index if not exists search_documents_updated_at_idx
  on public.search_documents(updated_at desc);

create index if not exists search_documents_search_vector_idx
  on public.search_documents
  using gin (search_vector);

create index if not exists search_documents_title_alias_trgm_idx
  on public.search_documents
  using gin (title_alias_text extensions.gin_trgm_ops);

create index if not exists search_documents_title_alias_prefix_idx
  on public.search_documents (title_alias_text text_pattern_ops);

create table if not exists public.search_sync_state (
  sync_key text primary key,
  status text not null check (status in ('idle', 'running', 'complete', 'error')),
  last_started_at timestamptz,
  last_completed_at timestamptz,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.search_documents enable row level security;
alter table public.search_sync_state enable row level security;

drop policy if exists "public read search documents" on public.search_documents;
create policy "public read search documents"
  on public.search_documents
  for select
  using (true);

grant select on table public.search_documents to anon, authenticated;
grant all on table public.search_documents to service_role;
grant all on table public.search_sync_state to service_role;

create or replace function public.replace_search_documents_for_source(source_type_in text, rows_in jsonb)
returns jsonb
language plpgsql
security definer
as $$
declare
  safe_rows jsonb := case
    when rows_in is not null and jsonb_typeof(rows_in) = 'array' then rows_in
    else '[]'::jsonb
  end;
  normalized_source_type text := nullif(btrim(source_type_in), '');
  result jsonb;
begin
  if normalized_source_type is null then
    raise exception 'source_type_in is required';
  end if;

  with input as (
    select distinct on (doc_id)
      doc_id,
      normalized_source_type as source_type,
      doc_type,
      url,
      title,
      subtitle,
      summary,
      body_preview,
      aliases,
      keywords,
      badge,
      image_url,
      published_at,
      source_updated_at,
      boost,
      metadata,
      content_hash
    from (
      select
        nullif(btrim(r.doc_id), '') as doc_id,
        lower(nullif(btrim(r.doc_type), '')) as doc_type,
        nullif(btrim(r.url), '') as url,
        nullif(btrim(r.title), '') as title,
        nullif(btrim(r.subtitle), '') as subtitle,
        nullif(btrim(r.summary), '') as summary,
        nullif(btrim(r.body_preview), '') as body_preview,
        case
          when r.aliases is null then '{}'::text[]
          when jsonb_typeof(r.aliases) = 'array' then coalesce((
            select array_agg(value order by ordinality)
            from (
              select nullif(btrim(value), '') as value, ordinality
              from jsonb_array_elements_text(r.aliases) with ordinality as v(value, ordinality)
            ) cleaned
            where value is not null
          ), '{}'::text[])
          else '{}'::text[]
        end as aliases,
        case
          when r.keywords is null then '{}'::text[]
          when jsonb_typeof(r.keywords) = 'array' then coalesce((
            select array_agg(value order by ordinality)
            from (
              select nullif(btrim(value), '') as value, ordinality
              from jsonb_array_elements_text(r.keywords) with ordinality as v(value, ordinality)
            ) cleaned
            where value is not null
          ), '{}'::text[])
          else '{}'::text[]
        end as keywords,
        nullif(btrim(r.badge), '') as badge,
        nullif(btrim(r.image_url), '') as image_url,
        r.published_at,
        r.source_updated_at,
        coalesce(r.boost, 0) as boost,
        coalesce(r.metadata, '{}'::jsonb) as metadata,
        coalesce(nullif(btrim(r.content_hash), ''), md5(coalesce(r.title, '') || '|' || coalesce(r.url, ''))) as content_hash
      from jsonb_to_recordset(safe_rows) as r(
        doc_id text,
        doc_type text,
        url text,
        title text,
        subtitle text,
        summary text,
        body_preview text,
        aliases jsonb,
        keywords jsonb,
        badge text,
        image_url text,
        published_at timestamptz,
        source_updated_at timestamptz,
        boost double precision,
        metadata jsonb,
        content_hash text
      )
    ) prepared
    where doc_id is not null
      and doc_type in ('launch', 'hub', 'guide', 'news', 'contract', 'person', 'recovery', 'catalog', 'page')
      and url is not null
      and title is not null
  ),
  deleted as (
    delete from public.search_documents d
    where d.source_type = normalized_source_type
      and not exists (
        select 1
        from input i
        where i.doc_id = d.doc_id
      )
    returning 1
  ),
  upserted as (
    insert into public.search_documents (
      doc_id,
      source_type,
      doc_type,
      url,
      title,
      subtitle,
      summary,
      body_preview,
      aliases,
      keywords,
      badge,
      image_url,
      published_at,
      source_updated_at,
      boost,
      metadata,
      content_hash
    )
    select
      doc_id,
      source_type,
      doc_type,
      url,
      title,
      subtitle,
      summary,
      body_preview,
      aliases,
      keywords,
      badge,
      image_url,
      published_at,
      source_updated_at,
      boost,
      metadata,
      content_hash
    from input
    on conflict (doc_id) do update
      set source_type = excluded.source_type,
          doc_type = excluded.doc_type,
          url = excluded.url,
          title = excluded.title,
          subtitle = excluded.subtitle,
          summary = excluded.summary,
          body_preview = excluded.body_preview,
          aliases = excluded.aliases,
          keywords = excluded.keywords,
          badge = excluded.badge,
          image_url = excluded.image_url,
          published_at = excluded.published_at,
          source_updated_at = excluded.source_updated_at,
          boost = excluded.boost,
          metadata = excluded.metadata,
          content_hash = excluded.content_hash,
          updated_at = now()
      where search_documents.content_hash is distinct from excluded.content_hash
         or search_documents.source_type is distinct from excluded.source_type
         or search_documents.doc_type is distinct from excluded.doc_type
         or search_documents.url is distinct from excluded.url
         or search_documents.title is distinct from excluded.title
         or search_documents.subtitle is distinct from excluded.subtitle
         or search_documents.summary is distinct from excluded.summary
         or search_documents.body_preview is distinct from excluded.body_preview
         or search_documents.aliases is distinct from excluded.aliases
         or search_documents.keywords is distinct from excluded.keywords
         or search_documents.badge is distinct from excluded.badge
         or search_documents.image_url is distinct from excluded.image_url
         or search_documents.published_at is distinct from excluded.published_at
         or search_documents.source_updated_at is distinct from excluded.source_updated_at
         or search_documents.boost is distinct from excluded.boost
         or search_documents.metadata is distinct from excluded.metadata
    returning (xmax = 0) as inserted
  )
  select jsonb_build_object(
    'source', normalized_source_type,
    'input', (select count(*) from input),
    'inserted', (select count(*) from upserted where inserted),
    'updated', (select count(*) from upserted where not inserted),
    'deleted', (select count(*) from deleted)
  )
    into result;

  return coalesce(result, '{}'::jsonb);
end;
$$;

revoke all on function public.replace_search_documents_for_source(text, jsonb) from public;
grant execute on function public.replace_search_documents_for_source(text, jsonb) to service_role;

create or replace function public.refresh_search_documents_db_sources()
returns jsonb
language plpgsql
security definer
as $$
declare
  launch_result jsonb;
  news_result jsonb;
  catalog_result jsonb;
begin
  select public.replace_search_documents_for_source(
    'launch',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'doc_id', 'launch:' || l.launch_id::text,
            'doc_type', 'launch',
            'url', public.search_build_launch_href(coalesce(nullif(l.slug, ''), l.name), l.launch_id),
            'title', l.name,
            'subtitle', concat_ws(' • ', nullif(l.provider, ''), nullif(l.vehicle, ''), nullif(coalesce(l.pad_name, l.pad_location_name, l.location_name), ''), case when l.net is not null then to_char(l.net at time zone 'UTC', 'Mon DD, YYYY HH24:MI "UTC"') else null end),
            'summary', coalesce(nullif(l.mission_description, ''), concat_ws(' • ', nullif(l.mission_name, ''), nullif(l.mission_type, ''), nullif(l.mission_orbit, ''))),
            'body_preview', trim(
              both ' ' from concat_ws(
                ' ',
                nullif(l.mission_description, ''),
                nullif(l.provider_description, ''),
                nullif(l.hold_reason, ''),
                nullif(l.fail_reason, ''),
                nullif(l.hashtag, ''),
                (
                  select string_agg(trim(coalesce(c.value->>'astronaut', c.value->>'name', c.value->>'role', '')), ' ')
                  from jsonb_array_elements(coalesce(l.crew, '[]'::jsonb)) as c(value)
                  where trim(coalesce(c.value->>'astronaut', c.value->>'name', c.value->>'role', '')) <> ''
                ),
                (
                  select string_agg(trim(coalesce(p.value->>'name', p.value->>'payload', p.value->>'payload_name', p.value->>'type', '')), ' ')
                  from jsonb_array_elements(coalesce(l.payloads, '[]'::jsonb)) as p(value)
                  where trim(coalesce(p.value->>'name', p.value->>'payload', p.value->>'payload_name', p.value->>'type', '')) <> ''
                )
              )
            ),
            'aliases', to_jsonb(array_remove(array[
              nullif(l.slug, ''),
              nullif(l.rocket_full_name, ''),
              nullif(l.rocket_family, ''),
              nullif(l.mission_name, ''),
              nullif(l.launch_designator, ''),
              nullif(l.hashtag, '')
            ], null)),
            'keywords', to_jsonb(array_remove(array[
              'launch',
              'launch detail',
              'countdown',
              nullif(l.provider, ''),
              nullif(l.vehicle, ''),
              nullif(l.rocket_full_name, ''),
              nullif(l.rocket_family, ''),
              nullif(l.mission_type, ''),
              nullif(l.mission_orbit, ''),
              nullif(l.pad_name, ''),
              nullif(l.pad_location_name, ''),
              nullif(l.pad_state, ''),
              nullif(l.status_name, ''),
              nullif(l.status_abbrev, '')
            ], null)),
            'badge', 'Launch',
            'image_url', coalesce(nullif(l.image_thumbnail_url, ''), nullif(l.rocket_image_url, '')),
            'published_at', l.net,
            'source_updated_at', l.cache_generated_at,
            'boost', case when l.featured then 56 else 44 end,
            'metadata', jsonb_build_object(
              'launchId', l.launch_id,
              'll2LaunchUuid', l.ll2_launch_uuid,
              'provider', l.provider,
              'vehicle', l.vehicle
            ),
            'content_hash', md5(
              concat_ws(
                '|',
                l.name,
                l.slug,
                l.provider,
                l.vehicle,
                l.net::text,
                l.status_name,
                l.status_abbrev,
                l.mission_name,
                l.mission_description,
                l.rocket_full_name,
                l.pad_name,
                l.pad_location_name,
                l.cache_generated_at::text
              )
            )
          )
          order by l.net asc nulls last, l.name asc
        )
        from public.launches_public_cache l
        where coalesce(l.hidden, false) is false
      ),
      '[]'::jsonb
    )
  )
    into launch_result;

  select public.replace_search_documents_for_source(
    'news',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'doc_id', 'news:' || n.snapi_uid,
            'doc_type', 'news',
            'url', n.url,
            'title', n.title,
            'subtitle', concat_ws(' • ', initcap(n.item_type), coalesce(nullif(n.news_site, ''), 'Spaceflight News')),
            'summary', nullif(n.summary, ''),
            'body_preview', nullif(n.summary, ''),
            'aliases', to_jsonb(array_remove(array[
              nullif(n.news_site, '')
            ], null)),
            'keywords', to_jsonb(array_remove(array[
              'news',
              'space news',
              nullif(n.item_type, ''),
              nullif(n.news_site, '')
            ], null)),
            'badge', 'News',
            'image_url', nullif(n.image_url, ''),
            'published_at', coalesce(n.published_at, n.updated_at, n.fetched_at),
            'source_updated_at', greatest(coalesce(n.updated_at, n.fetched_at), coalesce(n.published_at, n.fetched_at)),
            'boost', case when coalesce(n.featured, false) then 28 else 18 end,
            'metadata', jsonb_build_object(
              'snapiUid', n.snapi_uid,
              'itemType', n.item_type,
              'newsSite', n.news_site
            ),
            'content_hash', md5(
              concat_ws('|', n.title, n.url, n.news_site, n.summary, n.published_at::text, n.updated_at::text)
            )
          )
          order by coalesce(n.published_at, n.updated_at, n.fetched_at) desc nulls last, n.title asc
        )
        from public.snapi_items n
      ),
      '[]'::jsonb
    )
  )
    into news_result;

  select public.replace_search_documents_for_source(
    'catalog',
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'doc_id', 'catalog:' || c.entity_type || ':' || c.entity_id,
            'doc_type', 'catalog',
            'url', '/catalog/' || c.entity_type || '/' || c.entity_id,
            'title', c.name,
            'subtitle', initcap(replace(c.entity_type, '_', ' ')),
            'summary', nullif(c.description, ''),
            'body_preview', trim(
              both ' ' from concat_ws(
                ' ',
                nullif(c.description, ''),
                nullif(c.slug, ''),
                (
                  select string_agg(code, ' ')
                  from unnest(coalesce(c.country_codes, '{}'::text[])) as code
                ),
                coalesce(c.data->>'abbrev', ''),
                coalesce(c.data->>'description', '')
              )
            ),
            'aliases', to_jsonb(array_remove(array[
              nullif(c.slug, ''),
              nullif(c.data->>'abbrev', '')
            ], null)),
            'keywords', to_jsonb(array_cat(array['catalog', c.entity_type], coalesce(c.country_codes, '{}'::text[]))),
            'badge', 'Catalog',
            'image_url', nullif(c.image_url, ''),
            'published_at', null,
            'source_updated_at', coalesce(c.updated_at, c.fetched_at),
            'boost', case
              when c.entity_type = 'agencies' then 26
              when c.entity_type = 'astronauts' then 24
              when c.entity_type = 'pads' then 23
              when c.entity_type = 'launcher_configurations' then 23
              else 20
            end,
            'metadata', jsonb_build_object(
              'entityType', c.entity_type,
              'entityId', c.entity_id
            ),
            'content_hash', md5(
              concat_ws('|', c.entity_type, c.entity_id, c.name, c.slug, c.description, c.updated_at::text, c.image_url)
            )
          )
          order by c.entity_type asc, c.name asc
        )
        from public.ll2_catalog_public_cache c
      ),
      '[]'::jsonb
    )
  )
    into catalog_result;

  return jsonb_build_object(
    'launch', launch_result,
    'news', news_result,
    'catalog', catalog_result
  );
end;
$$;

revoke all on function public.refresh_search_documents_db_sources() from public;
grant execute on function public.refresh_search_documents_db_sources() to service_role;

create or replace function public.search_public_documents(
  q_in text,
  limit_n integer default 8,
  offset_n integer default 0,
  types_in text[] default null
)
returns table (
  id text,
  type text,
  title text,
  subtitle text,
  summary text,
  url text,
  image_url text,
  published_at timestamptz,
  badge text,
  score double precision
)
language sql
stable
as $$
  with raw_params as (
    select
      greatest(1, least(coalesce(limit_n, 8), 50)) as limit_n,
      greatest(0, coalesce(offset_n, 0)) as offset_n,
      nullif(btrim(q_in), '') as raw_query,
      public.search_extract_query_terms(q_in, false) as positive_query,
      public.search_extract_query_terms(q_in, true) as negated_query,
      case
        when types_in is null or cardinality(types_in) = 0 then null::text[]
        else (
          select coalesce(array_agg(distinct lower(btrim(value))), '{}'::text[])
          from unnest(types_in) as value
          where lower(btrim(value)) in ('launch', 'hub', 'guide', 'news', 'contract', 'person', 'recovery', 'catalog', 'page')
        )
      end as types
  ),
  params as (
    select
      p.limit_n,
      p.offset_n,
      p.raw_query,
      p.positive_query,
      p.negated_query,
      public.search_normalize_text(p.positive_query) as query_text,
      public.search_websearch_to_tsquery(p.raw_query) as tsq,
      public.search_websearch_to_tsquery(p.negated_query) as negated_tsq,
      public.search_prefix_tsquery(p.positive_query) as prefix_tsq,
      p.types
    from raw_params p
  ),
  scoped as (
    select d.*, p.query_text, p.tsq, p.negated_tsq, p.prefix_tsq
    from public.search_documents d
    cross join params p
    where p.raw_query is not null
      and coalesce(p.positive_query, '') <> ''
      and p.query_text <> ''
      and (
        p.types is null
        or cardinality(p.types) = 0
        or d.doc_type = any (p.types)
      )
  ),
  fts_candidates as (
    select s.doc_id
    from scoped s
    where s.tsq is not null
      and s.tsq @@ s.search_vector
    order by ts_rank_cd(s.search_vector, s.tsq) desc nulls last, s.published_at desc nulls last
    limit (select greatest(40, (limit_n + offset_n) * 8) from params)
  ),
  prefix_candidates as (
    select s.doc_id
    from scoped s
    where s.prefix_tsq is not null
      and s.prefix_tsq @@ s.search_vector
    order by
      case when s.title_alias_text like s.query_text || '%' then 1 else 0 end desc,
      s.published_at desc nulls last
    limit (select greatest(40, (limit_n + offset_n) * 6) from params)
  ),
  trigram_candidates as (
    select s.doc_id
    from scoped s
    where length(s.query_text) >= 3
      and (
        extensions.similarity(s.title_alias_text, s.query_text) > 0.3
        or s.title_alias_text like '%' || s.query_text || '%'
      )
    order by extensions.similarity(s.title_alias_text, s.query_text) desc nulls last, s.published_at desc nulls last
    limit (select greatest(30, (limit_n + offset_n) * 5) from params)
  ),
  candidate_ids as (
    select doc_id from fts_candidates
    union
    select doc_id from prefix_candidates
    union
    select doc_id from trigram_candidates
  ),
  ranked as (
    select
      d.doc_id as id,
      d.doc_type as type,
      d.title,
      d.subtitle,
      d.summary,
      d.url,
      d.image_url,
      d.published_at,
      d.badge,
      (
        case when public.search_normalize_text(d.title) = p.query_text then 8 else 0 end +
        case when exists (
          select 1
          from unnest(d.aliases) as alias
          where public.search_normalize_text(alias) = p.query_text
        ) then 7 else 0 end +
        case when d.title_alias_text like p.query_text || '%' then 4 else 0 end +
        case when position(p.query_text in d.title_alias_text) > 0 then 1.5 else 0 end +
        case when p.tsq is not null then ts_rank_cd(d.search_vector, p.tsq) * 6 else 0 end +
        case when p.prefix_tsq is not null and p.prefix_tsq @@ d.search_vector then 1.5 else 0 end +
        case when length(p.query_text) >= 3 then greatest(extensions.similarity(d.title_alias_text, p.query_text), 0) * 3.5 else 0 end +
        least(greatest(d.boost, 0), 200) / 20.0 +
        case
          when d.published_at is null then 0
          else greatest(0, 45 - extract(epoch from (now() - d.published_at)) / 86400.0) / 30.0
        end
      ) as score
    from candidate_ids c
    join public.search_documents d on d.doc_id = c.doc_id
    cross join params p
    where p.negated_tsq is null
      or p.negated_tsq @@ d.search_vector
  )
  select
    r.id,
    r.type,
    r.title,
    r.subtitle,
    r.summary,
    r.url,
    r.image_url,
    r.published_at,
    r.badge,
    r.score
  from ranked r
  order by r.score desc, r.published_at desc nulls last, r.title asc
  limit (select limit_n from params)
  offset (select offset_n from params);
$$;

grant execute on function public.search_public_documents(text, integer, integer, text[]) to anon, authenticated;
