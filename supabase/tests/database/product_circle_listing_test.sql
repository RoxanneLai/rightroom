begin;
create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public;
select no_plan();

select is(public.public_listing_url('https://www.productcircle.co/events/new-york-november-2026/?token=private&utm_source=test#private'), 'https://productcircle.co/events/new-york-november-2026', 'Product Circle canonicalizes and strips private parameters');
select is(public.public_listing_url('https://productcircle.co/events/boston-november-2026'), 'https://productcircle.co/events/boston-november-2026', 'distinct Product Circle editions remain distinct');
select is(public.public_listing_url('https://productcircle.co/events'), null::text, 'Product Circle directory is not a listing');
select is(public.public_listing_url('https://productcircle.co/events/nyc'), null::text, 'undated Product Circle paths are rejected');
select is(public.public_listing_url('https://productcircle.co/events/new-york-2026'), null::text, 'month is required');
select is(public.public_listing_url('https://productcircle.co/events/new-york-summer-2026'), null::text, 'non-month seasons are rejected');
select is(public.public_listing_url('https://productcircle.co/events/New-York-November-2026'), null::text, 'Product Circle identity is lowercase');
select is(public.public_listing_url('https://productcircle.co/events/new-york-november-26'), null::text, 'four-digit year is required');
select is(public.public_listing_url('https://productcircle.co/events/new-york-november-2026/extra'), null::text, 'nested Product Circle paths are rejected');
select is(public.public_listing_url('https://events.productcircle.co/events/new-york-november-2026'), null::text, 'unverified Product Circle subdomains are rejected');
select is(public.public_listing_url('https://user:private@productcircle.co/events/new-york-november-2026'), null::text, 'Product Circle credentials are rejected');

select * from finish();
rollback;
