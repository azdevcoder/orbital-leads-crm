# Referências de Implantação Render

O Render suporta serviços Node/Express ligados a um repositório GitHub, executando os comandos de build e de arranque definidos para o projeto. Após cada push para a branch ligada, o Render pode construir e implantar automaticamente a nova versão. As variáveis de ambiente devem ser configuradas no dashboard do serviço e não devem ser incluídas no repositório. [1] [2]

Para uma base de dados Render Postgres, o serviço deve utilizar a URL interna quando estiver na mesma região e conta da base de dados. A documentação indica que a URL externa se destina a ligações fora do Render e acrescenta latência. [3]

| Área | Requisito confirmado |
| --- | --- |
| Serviço web | Repositório GitHub ligado; comandos de build e start Node configurados. |
| Segredos | Variáveis configuradas no dashboard do Render; nunca em ficheiros `.env` enviados ao GitHub. |
| Base de dados | Serviço e Postgres na mesma região; URL interna para `DATABASE_URL`. |

## Referências

[1] [Deploy a Node Express App on Render](https://render.com/docs/deploy-node-express-app)

[2] [Environment Variables and Secrets](https://render.com/docs/configure-environment-variables)

[3] [Create and Connect to Render Postgres](https://render.com/docs/postgresql-creating-connecting)
