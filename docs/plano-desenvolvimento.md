# Plano de desenvolvimento — GKLI NewCore

A primeira entrega é o Core de acesso. A próxima entrega cobre cadastros, Inbox e acordos com dados controlados de homologação. A entrada automatizada de relatórios será planejada depois da validação desses fluxos. A especificação de infraestrutura e UI/UX governa a interface. A especificação funcional e o sistema legado descrevem a operação. O Workbook CoffeeColor fornece a identidade da GKLI.

| Etapa | Entrega | Aceite |
|---|---|---|
| 1. Fundação e Core | Interface HTML/CSS/JS, API Node.js na Vercel, Supabase Auth, sessão, login, recuperação, cards autorizados, usuários, equipes e permissões. | Testes de sessão, isolamento, teclado e largura de 390 px. |
| 2. Cadastros | Administradoras, condomínios, unidades, responsáveis, contatos e cotas. Dados controlados de homologação para exercitar a operação. | Vínculos cadastrais íntegros, isolamento por carteira e consulta da carteira de teste. |
| 3. Inbox e cobranças | Fila por responsável e condomínio, detalhamento por unidade, cotas e acordos em valores separados, histórico e próxima ação. | Filas, filtros e paginação com carteira representativa. |
| 4. Acordos e parcelas | Simulação à vista e parcelada, confirmação prévia pela planilha de débito da administradora, formalização, boleto quando disponível e conciliação de parcelas. | Cálculo fecha em centavos e gravação é transacional e idempotente. Pagamento passa sempre pela administradora. |
| 5. Flow | Três contatos em 21 dias por e-mail ou WhatsApp, após o prazo da administradora, agrupando cotas por unidade. | Teste sem envio, liberação da régua, revalidação da elegibilidade e controle de duplicidade por mensagem. |
| 6. Piloto e expansão | Reconciliação com a operação atual, acompanhamento da primeira carteira e priorização da entrada de dados e dos módulos restantes. | Conciliação, teste de carga e recuperação ensaiada. |

## Infraestrutura e desempenho

- GitHub com PRs e checks. Vercel Preview ligada à homologação com dados fictícios. Produção com Supabase separado. Migrações SQL versionadas e compatíveis com a versão publicada.
- Supabase RLS por carteira/equipe, Storage privado e transações para operações críticas. Funções Vercel próximas ao banco. Pool em modo transação quando houver conexão SQL direta serverless compatível.
- Paginação por cursor, filtros no banco e detalhe sob demanda. Índices orientados pelos filtros, ordenações e políticas RLS, validados com EXPLAIN ANALYZE em homologação.
- Parsing, OCR, exportações e envio em jobs retomáveis. Limitar concorrência, armazenar documentos em Storage e usar chaves de idempotência.
- Metas propostas para homologação com carga representativa: p95 de 500 ms para API da primeira página do Inbox e até 2 s para a lista utilizável. Medir também latência durante importação, idade da fila e falhas de entrega.

## Decisões antes das entregas correspondentes

Confirmar base e momento dos honorários GKLI de 10% à vista e 20% parcelado, incidência do 1% e tarifa fixa por boleto ou acordo. Validar os dias, canais e pausas do Flow. Escolher a administradora piloto e reunir amostras dos relatórios e da planilha de débito.

## Escopo confirmado

O Easy Cob é um protótipo do legado e fica fora das entregas do NewCore. Os contratos dos módulos principais orientam as validações de migração e homologação.

A variedade de formatos por administradora adia a implementação de novos adaptadores de PDF e Excel e do upload de produção. O adaptador Suit validado fica como referência técnica. A homologação do fluxo operacional usa dados fictícios e controlados. A estratégia para carregar a primeira carteira real será definida antes do piloto.
