update gkli_private.resources
set title = 'Inbox (Cobranças)', description = 'Acompanhe as cotas em aberto e os atendimentos.'
where code = 'inbox';

insert into gkli_private.resources (code, title, description, sort_order, published)
values ('relatorios', 'Relatórios', 'Consulte o resumo da carteira de cobrança e dos acordos.', 45, true);

create function gkli_private.demo_reports() returns jsonb
language sql stable security definer set search_path = ''
as $$
  with wallets as materialized (
    select d.wallet_id
    from gkli_private.demo_wallets d
    where d.wallet_id in (select gkli_private.wallet_access('relatorios', false))
  ), charges as (
    select count(*) as total, coalesce(sum(c.amount_cents), 0) as cents
    from gkli_private.demo_charges c
    join wallets w on w.wallet_id = c.wallet_id
    where not exists (
      select 1 from gkli_private.demo_agreement_charges l where l.charge_id = c.id
    )
  ), agreements as (
    select count(*) filter (where a.state = 'ativo') as active,
      count(*) filter (where a.state = 'quitado') as settled
    from gkli_private.demo_agreements a
    join wallets w on w.wallet_id = a.wallet_id
  )
  select jsonb_build_object(
    'wallets', (select count(*) from wallets),
    'open_charges', charges.total,
    'open_cents', charges.cents,
    'active_agreements', agreements.active,
    'settled_agreements', agreements.settled
  )
  from charges cross join agreements;
$$;

create function public.gkli_demo_reports() returns jsonb
language sql stable security invoker set search_path = ''
as $$ select gkli_private.demo_reports(); $$;

revoke execute on function public.gkli_demo_reports(), gkli_private.demo_reports() from public, anon, authenticated;
grant execute on function public.gkli_demo_reports(), gkli_private.demo_reports() to authenticated;
