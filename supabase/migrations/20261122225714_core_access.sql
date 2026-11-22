create schema gkli_private;
revoke all on schema gkli_private from public, anon, authenticated;
grant usage on schema gkli_private to authenticated;

create table gkli_private.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 120),
  active boolean not null default false,
  administrator boolean not null default false
);

create table gkli_private.resources (
  code text primary key,
  title text not null,
  description text not null,
  sort_order smallint not null,
  published boolean not null default false
);

insert into gkli_private.resources (code, title, description, sort_order, published) values
  ('core', 'Core de acesso', 'Gerencie usuários e permissões.', 10, true),
  ('cadastros', 'Cadastros', 'Consulte administradoras, condomínios e unidades.', 20, false),
  ('inbox', 'Inbox operacional', 'Acompanhe a fila de cobranças.', 30, false),
  ('acordos', 'Acordos', 'Consulte acordos e parcelas.', 40, false),
  ('flows', 'Flows', 'Acompanhe as réguas de comunicação.', 50, false);

create table gkli_private.resource_grants (
  user_id uuid not null references gkli_private.profiles (user_id) on delete cascade,
  resource_code text not null references gkli_private.resources (code),
  access_level text not null check (access_level in ('read', 'write')),
  primary key (user_id, resource_code)
);

create table gkli_private.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(name) between 1 and 120)
);

create table gkli_private.team_members (
  team_id uuid references gkli_private.teams (id) on delete cascade,
  user_id uuid references gkli_private.profiles (user_id) on delete cascade,
  primary key (team_id, user_id)
);
create index team_members_user_id_idx on gkli_private.team_members (user_id, team_id);

create table gkli_private.access_audit (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  target_id uuid not null,
  occurred_at timestamptz not null default clock_timestamp(),
  previous jsonb,
  current jsonb not null
);

alter table gkli_private.profiles enable row level security;
alter table gkli_private.resources enable row level security;
alter table gkli_private.resource_grants enable row level security;
alter table gkli_private.teams enable row level security;
alter table gkli_private.team_members enable row level security;
alter table gkli_private.access_audit enable row level security;

create function gkli_private.is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from gkli_private.profiles p
    where p.user_id = auth.uid() and p.active and p.administrator
  );
$$;

create function gkli_private.session_access() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'name', p.display_name,
    'administrator', p.administrator,
    'resources', coalesce((
      select jsonb_agg(jsonb_build_object(
        'code', r.code, 'title', r.title, 'description', r.description,
        'access', case when p.administrator then 'write' else g.access_level end
      ) order by r.sort_order)
      from gkli_private.resources r
      left join gkli_private.resource_grants g
        on g.resource_code = r.code and g.user_id = p.user_id
      where r.published and (p.administrator or (r.code <> 'core' and g.access_level is not null))
    ), '[]'::jsonb)
  )
  from gkli_private.profiles p where p.user_id = auth.uid() and p.active;
$$;

create function gkli_private.list_users(search text, after_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not gkli_private.is_admin() then
    raise insufficient_privilege using message = 'Acesso administrativo necessário.';
  end if;

  return (
    select coalesce(jsonb_agg(to_jsonb(items) order by items.id), '[]'::jsonb)
    from (
      select u.id, u.email, p.display_name, coalesce(p.active, false) as active,
        coalesce(p.administrator, false) as administrator, p.user_id is not null as admitted,
        coalesce((
          select jsonb_object_agg(g.resource_code, g.access_level)
          from gkli_private.resource_grants g where g.user_id = u.id
        ), '{}'::jsonb) as permissions,
        coalesce((
          select jsonb_agg(m.team_id order by m.team_id)
          from gkli_private.team_members m where m.user_id = u.id
        ), '[]'::jsonb) as team_ids
      from auth.users u left join gkli_private.profiles p on p.user_id = u.id
      where (after_id is null or u.id > after_id)
        and (coalesce(search, '') = '' or strpos(lower(coalesce(u.email, '')), lower(search)) > 0
          or strpos(lower(coalesce(p.display_name, '')), lower(search)) > 0)
      order by u.id limit 26
    ) items
  );
end;
$$;

create function gkli_private.core_catalog() returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not gkli_private.is_admin() then
    raise insufficient_privilege using message = 'Acesso administrativo necessário.';
  end if;
  return jsonb_build_object(
    'resources', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'title', title) order by sort_order), '[]'::jsonb)
      from gkli_private.resources where code <> 'core'),
    'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb)
      from gkli_private.teams)
  );
end;
$$;

create function gkli_private.create_team(team_name text) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare new_id uuid;
begin
  if not gkli_private.is_admin() then
    raise insufficient_privilege using message = 'Acesso administrativo necessário.';
  end if;
  insert into gkli_private.teams (name) values (btrim(team_name)) returning id into new_id;
  insert into gkli_private.access_audit (actor_id, target_id, current)
  values (auth.uid(), new_id, jsonb_build_object('team', btrim(team_name)));
  return new_id;
end;
$$;

create function gkli_private.save_user(
  target uuid, full_name text, enabled boolean, grants jsonb, team_ids uuid[]
) returns void
language plpgsql security definer set search_path = ''
as $$
declare before_change jsonb;
begin
  if not gkli_private.is_admin() then
    raise insufficient_privilege using message = 'Acesso administrativo necessário.';
  end if;
  if target = auth.uid() or exists (
    select 1 from gkli_private.profiles p where p.user_id = target and p.administrator
  ) then
    raise insufficient_privilege using message = 'Edite administradores pelo procedimento de provisionamento.';
  end if;
  if not exists (select 1 from auth.users u where u.id = target) then
    raise foreign_key_violation using message = 'Conta não encontrada.';
  end if;
  if enabled is null or jsonb_typeof(grants) is distinct from 'object' or team_ids is null then
    raise invalid_parameter_value using message = 'Configuração de acesso inválida.';
  end if;
  if exists (
    select 1 from jsonb_each_text(grants) item
    left join gkli_private.resources r on r.code = item.key
    where r.code is null or r.code = 'core' or item.value is null or item.value not in ('read', 'write')
  ) then
    raise invalid_parameter_value using message = 'Permissão inválida.';
  end if;

  -- Serialize changes for the target, including first admission when there is no profile row yet.
  perform 1 from auth.users u where u.id = target for update;
  select jsonb_build_object('name', p.display_name, 'active', p.active,
    'permissions', coalesce((select jsonb_object_agg(g.resource_code, g.access_level)
      from gkli_private.resource_grants g where g.user_id = target), '{}'::jsonb),
    'teams', coalesce((select jsonb_agg(m.team_id order by m.team_id)
      from gkli_private.team_members m where m.user_id = target), '[]'::jsonb))
    into before_change
    from gkli_private.profiles p where p.user_id = target;

  insert into gkli_private.profiles (user_id, display_name, active)
  values (target, btrim(full_name), enabled)
  on conflict (user_id) do update set display_name = excluded.display_name, active = excluded.active
  where not profiles.administrator;
  if not found then
    raise insufficient_privilege using message = 'Perfil administrativo protegido.';
  end if;

  delete from gkli_private.resource_grants where user_id = target;
  insert into gkli_private.resource_grants (user_id, resource_code, access_level)
    select target, item.key, item.value from jsonb_each_text(grants) item;
  delete from gkli_private.team_members where user_id = target;
  insert into gkli_private.team_members (team_id, user_id)
    select distinct id, target from unnest(team_ids) as teams(id);
  insert into gkli_private.access_audit (actor_id, target_id, previous, current)
  values (auth.uid(), target, before_change, jsonb_build_object(
    'name', btrim(full_name), 'active', enabled, 'permissions', grants, 'teams', team_ids
  ));
end;
$$;

create function public.gkli_session_access() returns jsonb
language sql stable security invoker set search_path = ''
as $$ select gkli_private.session_access(); $$;

create function public.gkli_core_list_users(search text, after_id uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select gkli_private.list_users(search, after_id); $$;

create function public.gkli_core_catalog() returns jsonb
language sql stable security invoker set search_path = ''
as $$ select gkli_private.core_catalog(); $$;

create function public.gkli_core_create_team(team_name text) returns uuid
language sql security invoker set search_path = ''
as $$ select gkli_private.create_team(team_name); $$;

create function public.gkli_core_save_user(target uuid, full_name text, enabled boolean, grants jsonb, team_ids uuid[]) returns void
language sql security invoker set search_path = ''
as $$ select gkli_private.save_user(target, full_name, enabled, grants, team_ids); $$;

revoke execute on all functions in schema gkli_private from public, anon, authenticated;
grant execute on function gkli_private.session_access(), gkli_private.list_users(text, uuid),
  gkli_private.core_catalog(), gkli_private.create_team(text),
  gkli_private.save_user(uuid, text, boolean, jsonb, uuid[]) to authenticated;

revoke execute on function public.gkli_session_access(), public.gkli_core_list_users(text, uuid),
  public.gkli_core_catalog(), public.gkli_core_create_team(text),
  public.gkli_core_save_user(uuid, text, boolean, jsonb, uuid[]) from public, anon, authenticated;
grant execute on function public.gkli_session_access(), public.gkli_core_list_users(text, uuid),
  public.gkli_core_catalog(), public.gkli_core_create_team(text),
  public.gkli_core_save_user(uuid, text, boolean, jsonb, uuid[]) to authenticated;
