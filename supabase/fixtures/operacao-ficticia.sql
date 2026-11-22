begin;

insert into public.gkli_carteiras (id, nome)
values ('f1000000-0000-4000-8000-000000000001', 'Homologação GKLI — carteira fictícia')
on conflict (id) do nothing;

insert into gkli_private.demo_wallets (wallet_id)
values ('f1000000-0000-4000-8000-000000000001')
on conflict do nothing;

insert into public.gkli_administradoras (id, carteira_id, codigo_origem, nome)
values ('f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
  'DEMO-ADM', 'Administradora Horizonte — fictícia')
on conflict (id) do nothing;

insert into public.gkli_condominios (id, carteira_id, administradora_id, codigo_origem, nome, dias_apos_vencimento_regua)
values ('f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001', 'DEMO-COND', 'Residencial Horizonte — fictício', 30)
on conflict (id) do nothing;

insert into public.gkli_unidades (id, carteira_id, condominio_id, bloco, codigo) values
  ('f4000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000001', 'A', '000204'),
  ('f4000000-0000-4000-8000-000000000002', 'f1000000-0000-4000-8000-000000000001',
    'f3000000-0000-4000-8000-000000000001', 'B', '000108')
on conflict (id) do nothing;

insert into public.gkli_responsaveis (id, carteira_id, administradora_id, codigo_origem, nome)
values ('f5000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001', 'DEMO-RESP', 'Responsável de teste')
on conflict (id) do nothing;

insert into public.gkli_unidades_responsaveis (carteira_id, unidade_id, responsavel_id, papel)
values ('f1000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001',
  'f5000000-0000-4000-8000-000000000001', 'Titular')
on conflict do nothing;

insert into public.gkli_contatos (carteira_id, responsavel_id, tipo, valor)
values ('f1000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001',
  'email', 'responsavel@example.test')
on conflict do nothing;

insert into gkli_private.demo_charges (wallet_id, unit_id, receipt, due_on, amount_cents) values
  ('f1000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'DEMO-0001',
    (now() at time zone 'America/Sao_Paulo')::date - 70, 125000),
  ('f1000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'DEMO-0002',
    (now() at time zone 'America/Sao_Paulo')::date - 40, 132503),
  ('f1000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000002', 'DEMO-0003',
    (now() at time zone 'America/Sao_Paulo')::date - 47, 75000)
on conflict (unit_id, receipt) do nothing;

commit;
