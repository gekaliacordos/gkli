create table public.gkli_carteiras (
  id uuid primary key default gen_random_uuid(),
  nome text not null unique check (length(btrim(nome)) between 1 and 160)
);

create table gkli_private.wallet_teams (
  wallet_id uuid not null references public.gkli_carteiras (id) on delete cascade,
  team_id uuid not null references gkli_private.teams (id) on delete cascade,
  primary key (wallet_id, team_id)
);
create index wallet_teams_team_id_idx on gkli_private.wallet_teams (team_id, wallet_id);
alter table gkli_private.wallet_teams enable row level security;

create table public.gkli_administradoras (
  id uuid primary key default gen_random_uuid(),
  carteira_id uuid not null references public.gkli_carteiras (id),
  codigo_origem text not null check (length(btrim(codigo_origem)) between 1 and 120),
  nome text not null check (length(btrim(nome)) between 1 and 160),
  unique (carteira_id, codigo_origem),
  unique (carteira_id, id)
);

create table public.gkli_condominios (
  id uuid primary key default gen_random_uuid(),
  carteira_id uuid not null,
  administradora_id uuid not null,
  codigo_origem text not null check (length(btrim(codigo_origem)) between 1 and 120),
  nome text not null check (length(btrim(nome)) between 1 and 160),
  dias_apos_vencimento_regua integer check (dias_apos_vencimento_regua >= 0),
  juros_price boolean not null default false,
  custo_emissao_boleto_centavos bigint not null default 0 check (custo_emissao_boleto_centavos >= 0),
  foreign key (carteira_id, administradora_id) references public.gkli_administradoras (carteira_id, id),
  unique (administradora_id, codigo_origem),
  unique (carteira_id, id)
);
create index gkli_condominios_carteira_adm_idx on public.gkli_condominios (carteira_id, administradora_id);

create table public.gkli_unidades (
  id uuid primary key default gen_random_uuid(),
  carteira_id uuid not null,
  condominio_id uuid not null,
  bloco text not null default '' check (length(bloco) <= 120),
  codigo text not null check (length(btrim(codigo)) between 1 and 120),
  foreign key (carteira_id, condominio_id) references public.gkli_condominios (carteira_id, id),
  unique (condominio_id, bloco, codigo),
  unique (carteira_id, id)
);
create index gkli_unidades_carteira_condominio_idx on public.gkli_unidades (carteira_id, condominio_id);

create table public.gkli_responsaveis (
  id uuid primary key default gen_random_uuid(),
  carteira_id uuid not null,
  administradora_id uuid not null,
  codigo_origem text not null check (length(btrim(codigo_origem)) between 1 and 120),
  nome text not null check (length(btrim(nome)) between 1 and 160),
  foreign key (carteira_id, administradora_id) references public.gkli_administradoras (carteira_id, id),
  unique (administradora_id, codigo_origem),
  unique (carteira_id, id)
);
create index gkli_responsaveis_carteira_adm_idx on public.gkli_responsaveis (carteira_id, administradora_id);

create table public.gkli_contatos (
  id uuid primary key default gen_random_uuid(),
  carteira_id uuid not null,
  responsavel_id uuid not null,
  tipo text not null check (tipo in ('email', 'telefone', 'whatsapp')),
  valor text not null check (length(btrim(valor)) between 1 and 254),
  foreign key (carteira_id, responsavel_id) references public.gkli_responsaveis (carteira_id, id),
  unique (responsavel_id, tipo, valor)
);
create index gkli_contatos_carteira_responsavel_idx on public.gkli_contatos (carteira_id, responsavel_id);

create table public.gkli_unidades_responsaveis (
  id uuid primary key default gen_random_uuid(),
  carteira_id uuid not null,
  unidade_id uuid not null,
  responsavel_id uuid not null,
  papel text not null check (length(btrim(papel)) between 1 and 80),
  inicio date,
  fim date,
  check (fim is null or inicio is null or fim >= inicio),
  foreign key (carteira_id, unidade_id) references public.gkli_unidades (carteira_id, id),
  foreign key (carteira_id, responsavel_id) references public.gkli_responsaveis (carteira_id, id),
  unique nulls not distinct (unidade_id, responsavel_id, papel, inicio)
);
create index gkli_unidades_responsaveis_by_person_idx on public.gkli_unidades_responsaveis (carteira_id, responsavel_id);
create index gkli_unidades_responsaveis_by_unit_idx on public.gkli_unidades_responsaveis (carteira_id, unidade_id);

create function gkli_private.wallet_access(resource text, editing boolean) returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select w.id
  from public.gkli_carteiras w
  join gkli_private.profiles p on p.user_id = auth.uid() and p.active
  where p.administrator

  union

  select wt.wallet_id
  from gkli_private.profiles p
  join gkli_private.resource_grants g on g.user_id = p.user_id
  join gkli_private.team_members tm on tm.user_id = p.user_id
  join gkli_private.wallet_teams wt on wt.team_id = tm.team_id
  where p.user_id = auth.uid() and p.active and not p.administrator
    and g.resource_code = resource and (not editing or g.access_level = 'write');
$$;

revoke execute on function gkli_private.wallet_access(text, boolean) from public, anon, authenticated;
grant execute on function gkli_private.wallet_access(text, boolean) to authenticated;

alter table public.gkli_carteiras enable row level security;
revoke all on public.gkli_carteiras from public, anon, authenticated;
grant select on public.gkli_carteiras to authenticated;
create policy carteiras_visiveis on public.gkli_carteiras for select to authenticated
using (id in (select gkli_private.wallet_access('cadastros', false)));

do $$
declare relation text;
begin
  foreach relation in array array[
    'gkli_administradoras', 'gkli_condominios', 'gkli_unidades',
    'gkli_responsaveis', 'gkli_contatos', 'gkli_unidades_responsaveis'
  ] loop
    execute format('alter table public.%I enable row level security', relation);
    execute format('revoke all on public.%I from public, anon, authenticated', relation);
    execute format('grant select on public.%I to authenticated', relation);
    execute format('create policy cadastros_visiveis on public.%I for select to authenticated
      using (carteira_id in (select gkli_private.wallet_access(''cadastros'', false)))', relation);
  end loop;
end;
$$;
