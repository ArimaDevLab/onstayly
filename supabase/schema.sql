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
alter table public.traces enable row level security;
alter table public.visits enable row level security;

-- 痕跡を残す(同じ人の痕跡は1つだけ。3時間より古いものはここで消える)
create or replace function public.leave_trace(tid uuid, px int, py int, pst text, pc int)
returns void language sql security definer set search_path = public as $$
  delete from traces where updated_at < now() - interval '3 hours';
  insert into traces (id, x, y, st, c) values (tid, px, py, pst, pc)
  on conflict (id) do update
    set x = excluded.x, y = excluded.y, st = excluded.st, c = excluded.c, updated_at = now();
$$;

-- 直近3時間の痕跡
create or replace function public.recent_traces()
returns table (id uuid, x int, y int, st text, c int, age_seconds int)
language sql stable security definer set search_path = public as $$
  select t.id, t.x, t.y, t.st, t.c, extract(epoch from now() - t.updated_at)::int
  from traces t
  where t.updated_at > now() - interval '3 hours'
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
