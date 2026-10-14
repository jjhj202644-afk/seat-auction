-- =====================================================================
--  학급 자리 경매 · Supabase 준비 명령
--  Supabase 왼쪽 메뉴 SQL Editor → New query 에 통째로 붙여넣고 Run.
--  여러 번 Run 해도 됩니다. (예전 토지대장 registry 표는 건드리지 않습니다)
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- 표 ----------
create table if not exists public.auc_rooms (
  code        text primary key,
  pin_hash    text not null,
  t_token     uuid not null default gen_random_uuid(),
  settings    jsonb not null,
  phase       text not null default 'lobby',
  round       int  not null default 0,
  deadline    timestamptz,
  reveal_at   timestamptz,
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.auc_students (
  code       text not null references public.auc_rooms(code) on delete cascade,
  no         int  not null,
  nick       text not null,
  token      uuid not null default gen_random_uuid(),
  assets     int,
  bid_any    boolean not null default false,
  joined_at  timestamptz not null default now(),
  primary key (code, no)
);

create table if not exists public.auc_seats (
  code       text not null references public.auc_rooms(code) on delete cascade,
  no         int  not null,
  r          int  not null,
  c          int  not null,
  gov        boolean not null default false,
  owner      int,
  price      int,
  won_round  int,
  tie        jsonb,
  tied       jsonb,
  sitter     int,
  rent       int,
  primary key (code, no)
);

create table if not exists public.auc_bids (
  code    text not null references public.auc_rooms(code) on delete cascade,
  round   int  not null,
  no      int  not null,
  seat    int  not null,
  amount  int  not null,
  at      timestamptz not null default now(),
  primary key (code, round, no, seat)
);

-- 표는 잠그고, 아래 함수로만 읽고 씁니다.
alter table public.auc_rooms    enable row level security;
alter table public.auc_students enable row level security;
alter table public.auc_seats    enable row level security;
alter table public.auc_bids     enable row level security;
revoke all on public.auc_rooms, public.auc_students, public.auc_seats, public.auc_bids from anon, authenticated;

-- ---------- 내부 도우미 ----------
create or replace function public.auc__cleanup()
returns void language sql security definer set search_path = public as $$
  delete from auc_rooms where created_at < now() - interval '24 hours';
$$;

create or replace function public.auc__room(p_code text, p_token uuid)
returns public.auc_rooms language plpgsql security definer set search_path = public as $$
declare r auc_rooms;
begin
  select * into r from auc_rooms where code = p_code and created_at > now() - interval '24 hours';
  if not found then raise exception 'not_found'; end if;
  if r.t_token is distinct from p_token then raise exception 'bad_token'; end if;
  return r;
end $$;

create or replace function public.auc__stud(p_code text, p_no int, p_token uuid)
returns public.auc_students language plpgsql security definer set search_path = public as $$
declare s auc_students;
begin
  if not exists (select 1 from auc_rooms where code = p_code and created_at > now() - interval '24 hours') then
    raise exception 'not_found';
  end if;
  select * into s from auc_students where code = p_code and no = p_no;
  if not found or s.token is distinct from p_token then raise exception 'kicked'; end if;
  return s;
end $$;

-- 한 학생이 이번 차수에 입찰할 수 있는 자리 수 (-1 = 제한 없음)
create or replace function public.auc__allowed(p_code text, p_no int)
returns int language plpgsql security definer set search_path = public as $$
declare mx int; owned int; presat boolean;
begin
  select coalesce((settings->>'maxSeats')::int, 1) into mx from auc_rooms where code = p_code;
  if mx <= 0 then return -1; end if;
  select count(*) into owned from auc_seats where code = p_code and owner = p_no;
  select exists(select 1 from auc_seats where code = p_code and gov and sitter = p_no) into presat;
  if mx = 1 and presat then return 0; end if;
  return greatest(mx - owned, 0);
end $$;

-- ---------- 교사 ----------
create or replace function public.auc_t_create(p_pin text, p_settings jsonb, p_seats jsonb)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare v_code text; v_tok uuid; s jsonb; tries int := 0;
begin
  perform auc__cleanup();
  if p_pin is null or length(trim(p_pin)) < 4 or length(trim(p_pin)) > 12 then raise exception 'bad_pin'; end if;
  if p_seats is null or jsonb_typeof(p_seats) <> 'array' or jsonb_array_length(p_seats) = 0 then raise exception 'bad_seats'; end if;
  if jsonb_array_length(p_seats) > 120 then raise exception 'bad_seats'; end if;
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from auc_rooms where code = v_code);
    tries := tries + 1;
    if tries > 50 then raise exception 'busy'; end if;
  end loop;
  insert into auc_rooms(code, pin_hash, settings)
    values (v_code, crypt(trim(p_pin), gen_salt('bf', 6)), p_settings)
    returning t_token into v_tok;
  for s in select * from jsonb_array_elements(p_seats) loop
    insert into auc_seats(code, no, r, c, gov, sitter)
    values (v_code, (s->>'no')::int, (s->>'r')::int, (s->>'c')::int,
            coalesce((s->>'gov')::boolean, false), nullif(s->>'sitter','')::int);
  end loop;
  return json_build_object('code', v_code, 'token', v_tok);
end $$;

create or replace function public.auc_t_login(p_code text, p_pin text)
returns json language plpgsql security definer set search_path = public, extensions as $$
declare r auc_rooms;
begin
  select * into r from auc_rooms where code = p_code and created_at > now() - interval '24 hours';
  if not found then perform pg_sleep(0.5); raise exception 'not_found'; end if;
  if r.pin_hash <> crypt(trim(coalesce(p_pin,'')), r.pin_hash) then perform pg_sleep(1); raise exception 'bad_pin'; end if;
  return json_build_object('code', r.code, 'token', r.t_token);
end $$;

create or replace function public.auc_t_state(p_code text, p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare rm auc_rooms;
begin
  rm := auc__room(p_code, p_token);
  return json_build_object(
    'now', now(),
    'room', json_build_object('code', rm.code, 'settings', rm.settings, 'phase', rm.phase, 'round', rm.round,
             'deadline', rm.deadline, 'reveal_at', rm.reveal_at, 'meta', rm.meta,
             'created_at', rm.created_at, 'expires_at', rm.created_at + interval '24 hours'),
    'students', coalesce((select json_agg(json_build_object('no', st.no, 'nick', st.nick, 'assets', st.assets,
             'bid_any', st.bid_any) order by st.no) from auc_students st where st.code = p_code), '[]'::json),
    'seats', coalesce((select json_agg(json_build_object('no', se.no, 'r', se.r, 'c', se.c, 'gov', se.gov,
             'owner', se.owner, 'price', se.price, 'won_round', se.won_round, 'tie', se.tie, 'tied', se.tied,
             'sitter', se.sitter, 'rent', se.rent) order by se.no) from auc_seats se where se.code = p_code), '[]'::json),
    'bids', coalesce((select json_agg(json_build_object('no', b.no, 'seat', b.seat, 'amount', b.amount, 'at', b.at)
             order by b.no, b.seat) from auc_bids b where b.code = p_code and b.round = rm.round), '[]'::json)
  );
end $$;

-- 교사 저장: 바뀐 것만 보냅니다.
--  p_room: phase, round, meta, settings, reveal_in(초), deadline_in(초|null), deadline_add(초)
--  p_students: [{no, assets?, remove?}]
--  p_seats:    [{no, gov?, owner?, price?, won_round?, tie?, tied?, sitter?, rent?}]
create or replace function public.auc_t_save(p_code text, p_token uuid, p_room jsonb, p_students jsonb, p_seats jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare r auc_rooms; e jsonb;
begin
  r := auc__room(p_code, p_token);
  p_room := coalesce(p_room, '{}'::jsonb);
  update auc_rooms set
    phase     = coalesce(p_room->>'phase', phase),
    round     = coalesce((p_room->>'round')::int, round),
    meta      = coalesce(p_room->'meta', meta),
    settings  = coalesce(p_room->'settings', settings),
    reveal_at = case when p_room ? 'reveal_in' then
                  case when p_room->'reveal_in' = 'null'::jsonb then null
                       else now() + make_interval(secs => (p_room->>'reveal_in')::numeric) end
                else reveal_at end,
    deadline  = case
                  when p_room ? 'deadline_in' then
                    case when p_room->'deadline_in' = 'null'::jsonb then null
                         else now() + make_interval(secs => (p_room->>'deadline_in')::numeric) end
                  when p_room ? 'deadline_add' then
                    greatest(coalesce(deadline, now()), now()) + make_interval(secs => (p_room->>'deadline_add')::numeric)
                  else deadline end,
    updated_at = now()
  where code = p_code;

  for e in select * from jsonb_array_elements(coalesce(p_students, '[]'::jsonb)) loop
    if coalesce((e->>'remove')::boolean, false) then
      delete from auc_bids where code = p_code and no = (e->>'no')::int;
      delete from auc_students where code = p_code and no = (e->>'no')::int;
    else
      update auc_students set
        assets = case when e ? 'assets' then (e->>'assets')::int else assets end
      where code = p_code and no = (e->>'no')::int;
    end if;
  end loop;

  for e in select * from jsonb_array_elements(coalesce(p_seats, '[]'::jsonb)) loop
    update auc_seats set
      gov       = case when e ? 'gov'       then coalesce((e->>'gov')::boolean, false) else gov end,
      owner     = case when e ? 'owner'     then (e->>'owner')::int     else owner end,
      price     = case when e ? 'price'     then (e->>'price')::int     else price end,
      won_round = case when e ? 'won_round' then (e->>'won_round')::int else won_round end,
      tie       = case when e ? 'tie'       then nullif(e->'tie', 'null'::jsonb)  else tie end,
      tied      = case when e ? 'tied'      then nullif(e->'tied', 'null'::jsonb) else tied end,
      sitter    = case when e ? 'sitter'    then (e->>'sitter')::int    else sitter end,
      rent      = case when e ? 'rent'      then (e->>'rent')::int      else rent end
    where code = p_code and no = (e->>'no')::int;
  end loop;

  return auc_t_state(p_code, p_token);
end $$;

create or replace function public.auc_t_delete(p_code text, p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
begin
  perform auc__room(p_code, p_token);
  delete from auc_rooms where code = p_code;
  return json_build_object('ok', true);
end $$;

-- ---------- 학생 ----------
create or replace function public.auc_s_join(p_code text, p_no int, p_nick text, p_assets int)
returns json language plpgsql security definer set search_path = public as $$
declare r auc_rooms; s auc_students; n text;
begin
  select * into r from auc_rooms where code = p_code and created_at > now() - interval '24 hours';
  if not found then perform pg_sleep(0.3); raise exception 'not_found'; end if;
  n := trim(coalesce(p_nick, ''));
  if length(n) < 1 or length(n) > 10 then raise exception 'bad_nick'; end if;
  if p_no is null or p_no < 1 or p_no > coalesce((r.settings->>'studentCount')::int, 0) then raise exception 'bad_no'; end if;

  select * into s from auc_students where code = p_code and no = p_no;
  if found then
    if lower(s.nick) <> lower(n) then raise exception 'taken'; end if;
    if r.phase = 'lobby' and p_assets is not null and p_assets >= 0 then
      update auc_students set assets = p_assets where code = p_code and no = p_no;
    end if;
    return json_build_object('token', s.token, 'rejoin', true);
  end if;

  if r.phase <> 'lobby' then raise exception 'closed'; end if;
  if p_assets is null or p_assets < 0 or p_assets > 100000000 then raise exception 'bad_assets'; end if;
  insert into auc_students(code, no, nick, assets) values (p_code, p_no, n, p_assets) returning * into s;
  return json_build_object('token', s.token, 'rejoin', false);
end $$;

create or replace function public.auc_s_state(p_code text, p_no int, p_token uuid)
returns json language plpgsql security definer set search_path = public as $$
declare s auc_students; r auc_rooms;
begin
  s := auc__stud(p_code, p_no, p_token);
  select * into r from auc_rooms where code = p_code;
  return json_build_object(
    'now', now(),
    'room', json_build_object('code', r.code, 'phase', r.phase, 'round', r.round, 'deadline', r.deadline,
             'reveal_at', r.reveal_at,
             'settings', json_build_object(
                'unit', r.settings->'unit', 'govName', r.settings->'govName', 'studentCount', r.settings->'studentCount',
                'rows', r.settings->'rows', 'cols', r.settings->'cols', 'deskPos', r.settings->'deskPos',
                'startPrice', r.settings->'startPrice', 'maxSeats', r.settings->'maxSeats',
                'timer', r.settings->'timer', 'tieMode', r.settings->'tieMode')),
    'me', json_build_object('no', s.no, 'nick', s.nick, 'assets', s.assets, 'allowed', auc__allowed(p_code, p_no)),
    'seats', coalesce((select json_agg(json_build_object('no', x.no, 'r', x.r, 'c', x.c, 'gov', x.gov,
             'owner', x.owner, 'owner_nick', so.nick, 'price', x.price, 'won_round', x.won_round,
             'tie', x.tie, 'tied', x.tied, 'sitter', x.sitter, 'sitter_nick', ss.nick, 'rent', x.rent) order by x.no)
             from auc_seats x
             left join auc_students so on so.code = x.code and so.no = x.owner
             left join auc_students ss on ss.code = x.code and ss.no = x.sitter
             where x.code = p_code), '[]'::json),
    'nicks', coalesce((select json_object_agg(no::text, nick) from auc_students where code = p_code), '{}'::json),
    'mybids', coalesce((select json_agg(json_build_object('seat', seat, 'amount', amount) order by seat)
             from auc_bids where code = p_code and round = r.round and no = p_no), '[]'::json)
  );
end $$;

create or replace function public.auc_s_assets(p_code text, p_no int, p_token uuid, p_assets int)
returns json language plpgsql security definer set search_path = public as $$
declare ph text;
begin
  perform auc__stud(p_code, p_no, p_token);
  select phase into ph from auc_rooms where code = p_code;
  if ph <> 'lobby' then raise exception 'locked'; end if;
  if p_assets is null or p_assets < 0 or p_assets > 100000000 then raise exception 'bad_assets'; end if;
  update auc_students set assets = p_assets where code = p_code and no = p_no;
  return json_build_object('ok', true);
end $$;

create or replace function public.auc_s_bid(p_code text, p_no int, p_token uuid, p_bids jsonb)
returns json language plpgsql security definer set search_path = public as $$
declare s auc_students; r auc_rooms; e jsonb; n int; total bigint := 0; allowed int;
        sp int; seat_no int; amt int; seen int[] := '{}';
begin
  s := auc__stud(p_code, p_no, p_token);
  select * into r from auc_rooms where code = p_code for update;
  if r.phase <> 'bidding' then raise exception 'not_bidding'; end if;
  if r.deadline is not null and now() > r.deadline + interval '1 second' then raise exception 'too_late'; end if;
  if p_bids is null or jsonb_typeof(p_bids) <> 'array' then raise exception 'bad_bids'; end if;
  n := jsonb_array_length(p_bids);
  allowed := auc__allowed(p_code, p_no);
  if allowed >= 0 and n > allowed then raise exception 'too_many'; end if;
  sp := coalesce((r.settings->>'startPrice')::int, 0);
  for e in select * from jsonb_array_elements(p_bids) loop
    seat_no := (e->>'seat')::int;
    amt := (e->>'amount')::int;
    if seat_no is null or amt is null then raise exception 'bad_bids'; end if;
    if seat_no = any(seen) then raise exception 'bad_bids'; end if;
    seen := seen || seat_no;
    if amt < sp or amt > 100000000 then raise exception 'too_low'; end if;
    if not exists (select 1 from auc_seats where code = p_code and no = seat_no
                   and not gov and owner is null and tie is null) then
      raise exception 'seat_taken';
    end if;
    total := total + amt;
  end loop;
  if total > coalesce(s.assets, 0) then raise exception 'over_budget'; end if;

  delete from auc_bids where code = p_code and round = r.round and no = p_no;
  insert into auc_bids(code, round, no, seat, amount)
    select p_code, r.round, p_no, (x->>'seat')::int, (x->>'amount')::int from jsonb_array_elements(p_bids) x;
  if n > 0 then update auc_students set bid_any = true where code = p_code and no = p_no; end if;
  return json_build_object('ok', true, 'count', n, 'total', total);
end $$;

create or replace function public.auc_s_pick(p_code text, p_no int, p_token uuid, p_seat int)
returns json language plpgsql security definer set search_path = public as $$
declare ph text;
begin
  perform auc__stud(p_code, p_no, p_token);
  select phase into ph from auc_rooms where code = p_code;
  if ph <> 'seatpick' then raise exception 'locked'; end if;
  if not exists (select 1 from auc_seats where code = p_code and no = p_seat and owner = p_no) then
    raise exception 'not_owner';
  end if;
  update auc_seats set sitter = null where code = p_code and owner = p_no and sitter = p_no;
  update auc_seats set sitter = p_no where code = p_code and no = p_seat;
  return json_build_object('ok', true);
end $$;

create or replace function public.auc_s_rent(p_code text, p_no int, p_token uuid, p_seat int, p_rent int)
returns json language plpgsql security definer set search_path = public as $$
declare ph text;
begin
  perform auc__stud(p_code, p_no, p_token);
  select phase into ph from auc_rooms where code = p_code;
  if ph <> 'rent' then raise exception 'locked'; end if;
  if p_rent is null or p_rent < 0 or p_rent > 100000000 then raise exception 'bad_rent'; end if;
  if not exists (select 1 from auc_seats where code = p_code and no = p_seat and owner = p_no
                   and coalesce(sitter, -1) <> p_no and (sitter is null or rent is null)) then
    raise exception 'locked';
  end if;
  update auc_seats set rent = p_rent where code = p_code and no = p_seat;
  return json_build_object('ok', true);
end $$;

-- ---------- 권한 ----------
revoke all on function
  public.auc__cleanup(), public.auc__room(text, uuid), public.auc__stud(text, int, uuid), public.auc__allowed(text, int),
  public.auc_t_create(text, jsonb, jsonb), public.auc_t_login(text, text), public.auc_t_state(text, uuid),
  public.auc_t_save(text, uuid, jsonb, jsonb, jsonb), public.auc_t_delete(text, uuid),
  public.auc_s_join(text, int, text, int), public.auc_s_state(text, int, uuid), public.auc_s_assets(text, int, uuid, int),
  public.auc_s_bid(text, int, uuid, jsonb), public.auc_s_pick(text, int, uuid, int), public.auc_s_rent(text, int, uuid, int, int)
from public;

grant execute on function
  public.auc_t_create(text, jsonb, jsonb), public.auc_t_login(text, text), public.auc_t_state(text, uuid),
  public.auc_t_save(text, uuid, jsonb, jsonb, jsonb), public.auc_t_delete(text, uuid),
  public.auc_s_join(text, int, text, int), public.auc_s_state(text, int, uuid), public.auc_s_assets(text, int, uuid, int),
  public.auc_s_bid(text, int, uuid, jsonb), public.auc_s_pick(text, int, uuid, int), public.auc_s_rent(text, int, uuid, int, int)
to anon, authenticated;

notify pgrst, 'reload schema';
