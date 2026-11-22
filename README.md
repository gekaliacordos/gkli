# GKLI NewCore

## Login local

Requer Node.js 24. Copie `.env.example` para `.env.local` e configure a URL e a chave publicável do ambiente.

Aplique a migração versionada do Core antes do primeiro login. Um administrador do banco deve vincular a conta inicial confirmada no Supabase Auth a um perfil ativo:

```sql
insert into gkli_private.profiles (user_id, display_name, active, administrator)
select id, 'Administrador GKLI', true, true
from auth.users
where id = '<UUID da conta inicial>'::uuid and email_confirmed_at is not null;
```

Crie ou convide outras contas pelo Supabase Auth. No Core, o administrador localiza a conta, ativa o acesso, atribui permissões de leitura ou edição e vincula equipes. A promoção de administradores segue o procedimento de provisionamento.

Execute `npm run dev` e abra http://localhost:3000. A sessão atual dura no máximo uma hora e pede novo login ao expirar.

## Vercel e recuperação

Configure as mesmas variáveis por ambiente. Use a origem HTTPS exata da aplicação em `APP_ORIGIN` ou deixe a Vercel fornecer `VERCEL_URL` para um preview. No Supabase Auth, permita o URL raiz do ambiente como destino da recuperação e configure o SMTP para entrega de e-mail. O link com PKCE deve ser aberto no mesmo navegador em que foi solicitado. Para validar a integração, teste login válido e inválido, logout e recuperação em homologação.

O plano de desenvolvimento está em [docs/plano-desenvolvimento.md](docs/plano-desenvolvimento.md).

## Operação fictícia

Para testar Cadastros, Inbox, simulação e acompanhamento de parcelas no ambiente de homologação, aplique as migrações e a carga fictícia separada. Siga o [roteiro de homologação](docs/operacao-homologacao.md).
