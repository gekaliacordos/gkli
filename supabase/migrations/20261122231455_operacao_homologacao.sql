create table gkli_private.demo_wallets (
  wallet_id uuid primary key references public.gkli_carteiras (id) on delete cascade
);

create table gkli_private.demo_charges (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null,
  unit_id uuid not null,
  receipt text not null check (length(btrim(receipt)) between 1 and 100),
  due_on date not null,
  amount_cents integer not null check (amount_cents between 1 and 100000000),
  foreign key (wallet_id, unit_id) references public.gkli_unidades (carteira_id, id),
  unique (unit_id, receipt)
);

create table gkli_private.demo_agreements (
  id uuid primary key,
  wallet_id uuid not null,
  unit_id uuid not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  state text not null default 'conferido' check (state in ('conferido', 'ativo', 'quitado')),
  amount_cents bigint not null check (amount_cents > 0),
  fee_cents bigint not null check (fee_cents >= 0),
  installment_count integer not null check (installment_count between 1 and 12),
  first_due date not null,
  evidence text not null check (length(btrim(evidence)) between 1 and 150),
  activated_by uuid,
  activated_at timestamptz,
  foreign key (wallet_id, unit_id) references public.gkli_unidades (carteira_id, id)
);

create unique index demo_one_unclosed_agreement_per_unit
  on gkli_private.demo_agreements (unit_id) where state in ('conferido', 'ativo');

create table gkli_private.demo_agreement_charges (
  agreement_id uuid not null references gkli_private.demo_agreements (id),
  charge_id uuid not null unique references gkli_private.demo_charges (id),
  primary key (agreement_id, charge_id)
);

create table gkli_private.demo_installments (
  agreement_id uuid not null references gkli_private.demo_agreements (id),
  number integer not null check (number > 0),
  due_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  paid_on date,
  payment_evidence text,
  recorded_by uuid,
  recorded_at timestamptz,
  primary key (agreement_id, number),
  check ((paid_on is null and payment_evidence is null and recorded_by is null and recorded_at is null)
    or (paid_on is not null and payment_evidence is not null and recorded_by is not null and recorded_at is not null))
);

alter table gkli_private.demo_wallets enable row level security;
alter table gkli_private.demo_charges enable row level security;
alter table gkli_private.demo_agreements enable row level security;
alter table gkli_private.demo_agreement_charges enable row level security;
alter table gkli_private.demo_installments enable row level security;

create function gkli_private.demo_scope(unit uuid, resource text, editing boolean) returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare wallet uuid;
begin
  select u.carteira_id into wallet
    from public.gkli_unidades u join gkli_private.demo_wallets d on d.wallet_id = u.carteira_id
    where u.id = unit and u.carteira_id in (select gkli_private.wallet_access(resource, editing));
  if not found then
    raise insufficient_privilege using message = 'Unidade fora do seu acesso de homologação.';
  end if;
  return wallet;
end;
$$;

create function gkli_private.demo_catalog(resource text, after_id uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if resource is null or resource not in ('cadastros', 'inbox', 'acordos') then
    raise invalid_parameter_value using message = 'Módulo inválido.';
  end if;
  return (
    select coalesce(jsonb_agg(to_jsonb(items) order by items.id), '[]'::jsonb)
    from (
      select u.id, u.codigo, u.bloco, c.nome as condominio, a.nome as administradora,
        (select coalesce(sum(dc.amount_cents), 0) from gkli_private.demo_charges dc
          where dc.unit_id = u.id and not exists (
            select 1 from gkli_private.demo_agreement_charges ac where ac.charge_id = dc.id
          )) as cotas_em_aberto,
        (select da.state from gkli_private.demo_agreements da
          where da.unit_id = u.id order by da.created_at desc, da.id desc limit 1) as estado_acordo
      from public.gkli_unidades u
      join gkli_private.demo_wallets d on d.wallet_id = u.carteira_id
      join public.gkli_condominios c on c.id = u.condominio_id
      join public.gkli_administradoras a on a.id = c.administradora_id
      where u.carteira_id in (select gkli_private.wallet_access(resource, false))
        and (after_id is null or u.id > after_id)
        and (resource <> 'acordos' or exists (select 1 from gkli_private.demo_agreements da where da.unit_id = u.id))
        and (resource <> 'inbox' or exists (select 1 from gkli_private.demo_charges dc where dc.unit_id = u.id))
      order by u.id limit 26
    ) items
  );
end;
$$;

create function gkli_private.demo_details(unit uuid, resource text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  if resource is null or resource not in ('cadastros', 'inbox', 'acordos') then
    raise invalid_parameter_value using message = 'Módulo inválido.';
  end if;
  perform gkli_private.demo_scope(unit, resource, false);
  return jsonb_build_object(
    'canEdit', exists (select 1 from public.gkli_unidades u where u.id = unit
      and u.carteira_id in (select gkli_private.wallet_access('acordos', true))),
    'hasCheckedAgreement', exists (select 1 from gkli_private.demo_agreements a
      where a.unit_id = unit and a.state = 'conferido'),
    'contacts', case when resource = 'cadastros' then (
      select coalesce(jsonb_agg(to_jsonb(items)), '[]'::jsonb) from (
        select r.nome, ur.papel, ct.tipo, ct.valor
        from public.gkli_unidades_responsaveis ur
        join public.gkli_responsaveis r on r.id = ur.responsavel_id
        left join public.gkli_contatos ct on ct.responsavel_id = r.id
        where ur.unidade_id = unit
        order by r.nome, ct.tipo limit 50
      ) items
    ) else '[]'::jsonb end,
    'charges', case when resource in ('inbox', 'acordos') then (
      select coalesce(jsonb_agg(to_jsonb(items)), '[]'::jsonb) from (
        select c.receipt, c.due_on, c.amount_cents, ac.agreement_id
        from gkli_private.demo_charges c
        left join gkli_private.demo_agreement_charges ac on ac.charge_id = c.id
        where c.unit_id = unit order by c.due_on, c.id limit 100
      ) items
    ) else '[]'::jsonb end,
    'agreements', case when resource = 'acordos' then (
      select coalesce(jsonb_agg(to_jsonb(items)), '[]'::jsonb) from (
        select a.id, a.state, a.amount_cents, a.fee_cents, a.evidence,
          coalesce((select jsonb_agg(jsonb_build_object(
            'number', i.number, 'due_on', i.due_on, 'amount_cents', i.amount_cents, 'paid_on', i.paid_on
          ) order by i.number) from gkli_private.demo_installments i where i.agreement_id = a.id), '[]'::jsonb) as installments
        from gkli_private.demo_agreements a where a.unit_id = unit
        order by a.created_at desc, a.id desc limit 25
      ) items
    ) else '[]'::jsonb end
  );
end;
$$;

create function gkli_private.demo_quote(unit uuid, parts integer) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare base_cents bigint; fee bigint; charge_count integer;
begin
  perform gkli_private.demo_scope(unit, 'acordos', false);
  if parts is null or parts not between 1 and 12 then
    raise invalid_parameter_value using message = 'Informe entre 1 e 12 parcelas.';
  end if;
  if exists (select 1 from public.gkli_unidades u join public.gkli_condominios c on c.id = u.condominio_id
      where u.id = unit and (c.juros_price or c.custo_emissao_boleto_centavos > 0)) then
    raise invalid_parameter_value using message = 'A simulação de homologação usa condições sem Price e sem tarifa de boleto.';
  end if;
  select coalesce(sum(c.amount_cents), 0), count(*) into base_cents, charge_count
    from gkli_private.demo_charges c where c.unit_id = unit
    and not exists (select 1 from gkli_private.demo_agreement_charges ac where ac.charge_id = c.id);
  fee := round(base_cents * (case when parts = 1 then 0.10 else 0.20 end));
  if base_cents + fee < parts then
    raise invalid_parameter_value using message = 'Saldo insuficiente para o parcelamento.';
  end if;
  return jsonb_build_object('base', base_cents, 'fee', fee, 'total', base_cents + fee, 'count', charge_count,
    'regular', (base_cents + fee) / parts, 'last', (base_cents + fee) / parts + (base_cents + fee) % parts);
end;
$$;

create function gkli_private.demo_check(
  unit uuid, request_id uuid, parts integer, first_due date, verified_cents bigint, reference text
) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare wallet uuid; quote jsonb; previous gkli_private.demo_agreements%rowtype;
begin
  wallet := gkli_private.demo_scope(unit, 'acordos', true);
  if request_id is null or parts is null or first_due is null or verified_cents is null
     or reference is null or length(btrim(reference)) not between 1 and 150 then
    raise invalid_parameter_value using message = 'Informe os dados da conferência.';
  end if;
  perform 1 from public.gkli_unidades u where u.id = unit for update;
  select * into previous from gkli_private.demo_agreements a where a.id = request_id;
  if found then
    if previous.unit_id = unit and previous.installment_count = parts
       and previous.first_due = first_due and previous.amount_cents = verified_cents
       and previous.evidence = btrim(reference) then return request_id; end if;
    raise unique_violation using message = 'A chave da operação já foi utilizada.';
  end if;
  if first_due < (now() at time zone 'America/Sao_Paulo')::date then
    raise invalid_parameter_value using message = 'O primeiro vencimento precisa ser hoje ou uma data futura.';
  end if;
  quote := gkli_private.demo_quote(unit, parts);
  if (quote->>'total')::bigint is distinct from verified_cents then
    raise invalid_parameter_value using message = 'O valor conferido diverge da simulação atual.';
  end if;
  insert into gkli_private.demo_agreements
    (id, wallet_id, unit_id, created_by, amount_cents, fee_cents, installment_count, first_due, evidence)
    values (request_id, wallet, unit, auth.uid(), verified_cents, (quote->>'fee')::bigint, parts, first_due, btrim(reference));
  insert into gkli_private.demo_agreement_charges (agreement_id, charge_id)
    select request_id, c.id from gkli_private.demo_charges c where c.unit_id = unit
    and not exists (select 1 from gkli_private.demo_agreement_charges ac where ac.charge_id = c.id);
  return request_id;
end;
$$;

create function gkli_private.demo_activate(agreement uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare current_agreement gkli_private.demo_agreements%rowtype; part bigint;
begin
  select * into current_agreement from gkli_private.demo_agreements a where a.id = agreement;
  perform gkli_private.demo_scope(current_agreement.unit_id, 'acordos', true);
  select * into current_agreement from gkli_private.demo_agreements a where a.id = agreement for update;
  if current_agreement.state <> 'conferido' then return; end if;
  part := current_agreement.amount_cents / current_agreement.installment_count;
  insert into gkli_private.demo_installments (agreement_id, number, due_on, amount_cents)
    select agreement, n,
      (current_agreement.first_due + make_interval(months => n - 1))::date,
      part + case when n = current_agreement.installment_count
        then current_agreement.amount_cents % current_agreement.installment_count else 0 end
    from generate_series(1, current_agreement.installment_count) as parts(n);
  update gkli_private.demo_agreements set state = 'ativo', activated_at = now(), activated_by = auth.uid()
    where id = agreement;
end;
$$;

create function gkli_private.demo_payment(agreement uuid, part integer, paid date, reference text) returns void
language plpgsql security definer set search_path = ''
as $$
declare current_agreement gkli_private.demo_agreements%rowtype; installment gkli_private.demo_installments%rowtype;
begin
  select * into current_agreement from gkli_private.demo_agreements a where a.id = agreement;
  perform gkli_private.demo_scope(current_agreement.unit_id, 'acordos', true);
  select * into current_agreement from gkli_private.demo_agreements a where a.id = agreement for update;
  if paid is null or paid > (now() at time zone 'America/Sao_Paulo')::date
    or reference is null or length(btrim(reference)) not between 1 and 150 then
    raise invalid_parameter_value using message = 'Informe a data e a referência do pagamento confirmado.';
  end if;
  select * into installment from gkli_private.demo_installments i where i.agreement_id = agreement and i.number = part;
  if not found then raise invalid_parameter_value using message = 'Parcela inexistente.'; end if;
  if installment.paid_on is not null then
    if installment.paid_on = paid and installment.payment_evidence = btrim(reference) then return; end if;
    raise unique_violation using message = 'A parcela já tem uma confirmação de pagamento.';
  end if;
  if current_agreement.state <> 'ativo' then
    raise invalid_parameter_value using message = 'O acordo ainda não está ativo.';
  end if;
  update gkli_private.demo_installments set paid_on = paid, payment_evidence = btrim(reference),
    recorded_by = auth.uid(), recorded_at = now() where agreement_id = agreement and number = part;
  if not exists (select 1 from gkli_private.demo_installments i where i.agreement_id = agreement and i.paid_on is null) then
    update gkli_private.demo_agreements set state = 'quitado' where id = agreement;
  end if;
end;
$$;

create function public.gkli_demo_catalog(resource text, after_id uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select gkli_private.demo_catalog(resource, after_id); $$;

create function public.gkli_demo_details(unit uuid, resource text) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select gkli_private.demo_details(unit, resource); $$;

create function public.gkli_demo_quote(unit uuid, parts integer) returns jsonb
language sql stable security invoker set search_path = ''
as $$ select gkli_private.demo_quote(unit, parts); $$;

create function public.gkli_demo_check(unit uuid, request_id uuid, parts integer, first_due date, verified_cents bigint, reference text)
returns uuid language sql security invoker set search_path = ''
as $$ select gkli_private.demo_check(unit, request_id, parts, first_due, verified_cents, reference); $$;

create function public.gkli_demo_activate(agreement uuid) returns void
language sql security invoker set search_path = ''
as $$ select gkli_private.demo_activate(agreement); $$;

create function public.gkli_demo_payment(agreement uuid, part integer, paid date, reference text) returns void
language sql security invoker set search_path = ''
as $$ select gkli_private.demo_payment(agreement, part, paid, reference); $$;

revoke execute on function gkli_private.demo_scope(uuid,text,boolean) from public, anon, authenticated;
do $$
declare fn regprocedure;
begin
  for fn in select p.oid::regprocedure from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'public' and p.proname like 'gkli_demo_%')
       or (n.nspname = 'gkli_private' and p.proname in ('demo_catalog','demo_details','demo_quote','demo_check','demo_activate','demo_payment'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

update gkli_private.resources set published = true where code in ('cadastros','inbox','acordos');
