-- Keep in sync with config/event-sources.json and public-listing-url.ts.
create or replace function public.public_listing_url(p_url text)
returns text language plpgsql immutable strict security invoker set search_path = '' as $$
declare v_url text; v_base text; v_id text;
begin
  if length(p_url) > 2048 or p_url ~ '[[:space:][:cntrl:]\\]' then return null; end if;
  v_url := regexp_replace(regexp_replace(split_part(p_url, '#', 1), '^https://www\.', 'https://'), '^https://lu\.ma/', 'https://luma.com/');
  v_base := regexp_replace(split_part(v_url, '?', 1), '/+$', '');
  if v_base = 'https://pminyc.org/calendar' then
    if v_url !~ '[?&]eventId=[0-9]{1,12}(&|$)'
      or (select count(*) from regexp_matches(v_url, '[?&]eventId=', 'g')) <> 1
      or v_url ~ '[?&][^=&]*%[^=&]*='
    then return null; end if;
    v_id := substring(v_url from '[?&]eventId=([0-9]{1,12})');
    return v_base || '?eventId=' || v_id;
  end if;
  if v_base ~ '^https://finos\.org/hosted-events/[A-Za-z0-9_-]+$'
    or v_base ~ '^https://events\.datadoghq\.com/events/[A-Za-z0-9_-]+$'
    or v_base ~ '^https://aicamp\.ai/event/eventdetails/W[0-9]{10}$'
    or v_base ~ '^https://productcircle\.co/events/[a-z]+(-[a-z]+)*-(january|february|march|april|may|june|july|august|september|october|november|december)-[0-9]{4}$'
    or (v_base ~ '^https://luma\.com/[A-Za-z0-9_-]+$' and v_base !~* '^https://luma\.com/(discover|explore|home|signin|login|pricing|calendar|create|nyc|new-york)$')
    or v_base ~ '^https://meetup\.com/[A-Za-z0-9_-]+/events/[0-9]+$'
    or v_base ~ '^https://eventbrite\.com/e/[A-Za-z0-9_-]*tickets-[0-9]+$'
  then return v_base; end if;
  return null;
end;
$$;
