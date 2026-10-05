-- いるだけの町 (onstayly) のデータベース設定。
-- Supabase の SQL Editor に全部貼って Run を1回押すだけです。何度実行しても壊れません。
-- 保存するのは「場所・していたこと・服の色・時刻」だけで、誰のものかは保存しません。

create table if not exists public.traces (
  id uuid primary key,
  x int not null check (x between 0 and 1400),
  y int not null check (y between 0 and 1000),
  st text not null check (st in ('zone','study','work','game','read','draw','music','eat','rest','walk')),
  c int not null check (c between 0 and 5),
  updated_at timestamptz not null default now()
);

create table if not exists public.visits (
  day date not null,
  visitor uuid not null,
  primary key (day, visitor)
);

-- テーブルへの直接アクセスは全て禁止し、下の関数だけを入口にします。
-- していることの種類を増やしたときは、ここの一覧も増やす
alter table public.traces drop constraint if exists traces_st_check;
alter table public.traces add constraint traces_st_check check (st in
  ('zone','study','work','game','read','draw','music','eat','cook','exercise','bath','rest','walk','sleep'));

alter table public.traces enable row level security;
alter table public.visits enable row level security;

-- 痕跡を残す(同じ人の痕跡は1つだけ。8時間より古いものはここで消える)
create or replace function public.leave_trace(tid uuid, px int, py int, pst text, pc int)
returns void language sql security definer set search_path = public as $$
  delete from traces where updated_at < now() - interval '8 hours';
  insert into traces (id, x, y, st, c) values (tid, px, py, pst, pc)
  on conflict (id) do update
    set x = excluded.x, y = excluded.y, st = excluded.st, c = excluded.c, updated_at = now();
$$;

-- 直近3時間の痕跡(「おやすみ中」だけは朝まで残すので8時間)
create or replace function public.recent_traces()
returns table (id uuid, x int, y int, st text, c int, age_seconds int)
language sql stable security definer set search_path = public as $$
  select t.id, t.x, t.y, t.st, t.c, extract(epoch from now() - t.updated_at)::int
  from traces t
  where t.updated_at > now() - (case when t.st = 'sleep' then interval '8 hours' else interval '3 hours' end)
  order by t.updated_at desc
  limit 200;
$$;

-- 今日(日本時間)立ち寄った人数。呼ぶと自分も1人として数えられる。
create or replace function public.check_in(v uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Asia/Tokyo')::date;
  n int;
begin
  insert into visits (day, visitor) values (d, v) on conflict do nothing;
  delete from visits where day < d - 7;
  select count(*) into n from visits where day = d;
  return n;
end $$;

grant execute on function public.leave_trace(uuid, int, int, text, int) to anon, authenticated;
grant execute on function public.recent_traces() to anon, authenticated;
grant execute on function public.check_in(uuid) to anon, authenticated;

-- みんなで積み上げる数字(いまはボウリングのピンだけ)。だれが足したかは保存しない。
create table if not exists public.town_counters (
  day date not null,
  key text not null check (key in ('pins')),
  total bigint not null default 0,
  primary key (day, key)
);
alter table public.town_counters enable row level security;

-- 今日(日本時間)の合計に足して、足したあとの合計を返す。1回に足せるのは30まで。
create or replace function public.bump_counter(k text, n int)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  d date := (now() at time zone 'Asia/Tokyo')::date;
  t bigint;
begin
  if k <> 'pins' or n is null or n < 0 or n > 30 then
    raise exception 'invalid counter';
  end if;
  insert into town_counters (day, key, total) values (d, k, n)
  on conflict (day, key) do update set total = town_counters.total + excluded.total
  returning total into t;
  delete from town_counters where day < d - 30;
  return t;
end $$;

create or replace function public.counter_today(k text)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select c.total from town_counters c
    where c.day = (now() at time zone 'Asia/Tokyo')::date and c.key = k), 0);
$$;

grant execute on function public.bump_counter(text, int) to anon, authenticated;
grant execute on function public.counter_today(text) to anon, authenticated;
