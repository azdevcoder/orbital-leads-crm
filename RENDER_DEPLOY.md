# Implantação no Render

O projeto está preparado para criação através do ficheiro `render.yaml`, que aprovisiona um serviço Node.js e um Postgres na região de Frankfurt. O serviço executa `pnpm build`, aplica as migrações antes de cada publicação e arranca através de `pnpm start`.

## Configuração necessária

Depois de ligar o repositório ao Render como **Blueprint**, introduza o valor de `GOOGLE_MAPS_API_KEY` quando o Render o solicitar. A chave deve ter a Places API ativada no Google Cloud e estar restringida ao uso pelo servidor. `JWT_SECRET` é gerada pelo Render e `DATABASE_URL` é fornecida pela base Postgres declarada no Blueprint.

| Variável | Origem | Finalidade |
| --- | --- | --- |
| `DATABASE_URL` | Base Render Postgres | Ligação interna à base de dados da aplicação. |
| `JWT_SECRET` | Gerada pelo Render | Assinatura das sessões de utilizador. |
| `GOOGLE_MAPS_API_KEY` | Utilizador no Render | Pesquisa e detalhe de locais no Google Places. |
| `NODE_ENV` | `render.yaml` | Ativa o modo de produção. |

Não envie ficheiros `.env` nem credenciais para o GitHub. O Render lê os segredos no dashboard e aplica-os no próximo deploy. [1] [2]

## Fluxo de publicação

1. No Render, selecione **New > Blueprint** e ligue o repositório privado `azdevcoder/orbital-leads-crm`.
2. Confirme `render.yaml`, introduza `GOOGLE_MAPS_API_KEY` e implemente o Blueprint.
3. Aguarde a criação da base Postgres e do Web Service. O `preDeployCommand` aplica o esquema antes do arranque.
4. Crie uma conta local na aplicação e execute uma pesquisa de teste.

## Referências

[1] [Render Blueprints (IaC)](https://render.com/docs/infrastructure-as-code)

[2] [Environment Variables and Secrets](https://render.com/docs/configure-environment-variables)
