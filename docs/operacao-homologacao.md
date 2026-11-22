# Operação fictícia no NewCore

O roteiro usa uma carteira de homologação com duas unidades, três cotas e um contato de exemplo. A operação só é habilitada para carteiras marcadas na tabela privada de demonstração. A estrutura de cadastros, a carga fictícia e os eventos da demonstração ficam separados.

## Roteiro de teste manual

1. Entre com a conta administradora do NewCore. Abra **Cadastros** e confira as unidades, o condomínio, a administradora e o responsável vinculado.
2. Abra **Inbox**, selecione a unidade **000204 / A** e acesse **Acordos da unidade**.
3. Simule **3 parcelas**. A simulação deve mostrar cotas de R$ 2.575,03, honorários de R$ 515,01 e total de R$ 3.090,04. A última parcela absorve o centavo de ajuste. A base e a divisão servem à demonstração.
4. No formulário de conferência, reproduza o total com `3090,04`, informe um vencimento atual ou futuro e uma referência fictícia. Um total divergente deve ser recusado. Depois da conferência, formalize o acordo fictício.
5. Confira as datas e os valores das três parcelas. Registre uma confirmação fictícia da administradora para cada uma. A última confirmação muda o acordo para **Quitado**. Repetir a mesma confirmação preserva um único registro. Referência ou data divergente em parcela já confirmada é recusada.

Cadastros são consultados nesse percurso. Criação e edição cadastral pela interface, seleção individual de cotas, encargos Price, tarifa de emissão, aceite, cancelamento, boleto, repasse e baixa parcial ficam para as entregas seguintes. O percurso exercita conferência e acompanhamento sem contato externo, emissão de boleto ou recebimento de dinheiro. Não é um ambiente de operação real.

## Dados e autorização

O módulo usa RLS nas tabelas expostas e RPCs que cruzam o perfil ativo, o nível de acesso, a carteira acessível e a marcação de operação fictícia. Consultar a simulação requer leitura de Acordos. Conferir, formalizar e registrar pagamento exigem edição. Conferência e ativação são operações distintas. Ativação cria parcelas em transação e o registro de pagamento usa a referência da administradora. Filtros de fila e ordenação mais completos serão validados com a operação.

O arquivo [de dados fictícios](../supabase/fixtures/operacao-ficticia.sql) é uma carga separada das migrações de schema. Execute em homologação. O script é repetível e preserva alterações já feitas na sessão de teste.

## Maestro e agentes

A etapa de automação parte do Maestro e dos agentes do módulo principal. Registrar pedido, origem, carteira e configuração. Separar aquisição e conversão do relatório, confirmação da importação, montagem e liberação do Flow. Cada worker precisa de claim e lease, tentativas limitadas, retomada pelo último efeito confirmado, acompanhamento de versão e heartbeat. Falha de login ou interpretação se distingue de relatório válido sem pendências. A operação manual de homologação não usa os agentes, e o Easy Cob permanece como referência de protótipo.
