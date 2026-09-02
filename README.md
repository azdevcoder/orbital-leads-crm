# Orbital Leads CRM — CRM B2B com Prospecção em Órbita

> **Centro de comando comercial** para capturar empresas via Google Places, organizar oportunidades num pipeline Kanban e fechar negócios num único lugar. Visual cósmico imersivo, isolamento total por tenant e exportações prontas para o time.

![Vite](https://img.shields.io/badge/Vite-7.x-646CFF?style=flat-square&logo=vite&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&logo=typescript&logoColor=white)
![tRPC](https://img.shields.io/badge/tRPC-11-2596BE?style=flat-square)
![Drizzle ORM](https://img.shields.io/badge/Drizzle-Postgres-C5F277?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-green?style=flat-square)

Repositório: [`azdevcoder/orbital-leads-crm`](https://github.com/azdevcoder/orbital-leads-crm) · Stack: **React 19 + Vite + Tailwind 4 + tRPC + Drizzle + PostgreSQL + Express**

---

## Índice

- [Visão Geral](#visão-geral)
- [Funcionalidades](#funcionalidades)
- [Stack Técnica](#stack-técnica)
- [Arquitetura & Estrutura](#arquitetura--estrutura)
- [Modelo de Dados](#modelo-de-dados)
- [API (tRPC)](#api-trpc)
- [Começando — Desenvolvimento Local](#começando--desenvolvimento-local)
- [Variáveis de Ambiente](#variáveis-de-ambiente)
- [Scripts](#scripts)
- [Testes](#testes)
- [Deploy no Render](#deploy-no-render)
- [Design System / UI](#design-system--ui)
- [Segurança e Isolamento por Tenant](#segurança-e-isolamento-por-tenant)
- [Verificação Visual](#verificação-visual)
- [Roadmap](#roadmap)
- [Licença](#licença)

---

## Visão Geral

O **Orbital Leads** nasceu para resolver o gargalo clássico de prospecção B2B local:

1. **Buscar** — o usuário informa `Segmento/Nicho + Cidade + UF` e o servidor consulta o **Google Places** (`Text Search` + `Place Details`).
2. **Normalizar & Persistir** — os campos `Nome, Telefone, Endereço completo, Website, Avaliação e Status` são normalizados e gravados com `tenantId` (`openId` do usuário).
3. **Gerir** — Dashboard com métricas, lista filtrável, pipeline Kanban com drag-and-drop, modal de lead com notas/histórico e ação **WhatsApp (wa.me)**.
4. **Exportar** — CSV (`json2csv`) e XLSX (`exceljs`) respeitando filtros e tenant.

Cada usuário é um **tenant isolado**: nenhuma query, mutação ou exportação cruza dados entre contas (`server/db.ts:142` e `server/routers.ts:28`).

---

## Funcionalidades

| Área | O que faz |
|------|-----------|
| **Autenticação local** | Registo e login por email + palavra-passe, hash `bcryptjs` (cost 12), sessão JWT assinada via `jose` e cookie `httpOnly` (`server/routers.ts:135`). |
| **Isolamento por tenant** | Todas as operações (`listLeads`, `upsertCapturedLeads`, `listSearchHistory`, etc.) filtram por `tenantId = ctx.user.openId` (`server/db.ts:142`). |
| **Busca Google Places** | `places.search` e `places.rerun` constroem a query `${segment} em ${city}, ${state}`, chamam `/maps/api/place/textsearch` + `/details` e fazem `upsert` em `leads` (`server/routers.ts:51`). |
| **Histórico de buscas** | `searches` guarda `segment/city/state/resultCount`; repetir busca com 1 clique (`server/routers.ts:226`). |
| **CRM — Lista** | Busca rápida (`like` em nome/telefone/endereço/website), filtros por `status/segment/city`, seleção múltipla para exportação (`server/db.ts:142`). |
| **CRM — Kanban** | 5 colunas (`Novo → Contatado → Em Negociação → Fechado → Perdido`), drag-and-drop com `SortableJS`, `applyKanbanMove` valida troca antes de mutar (`client/src/App.tsx:73`). |
| **Modal de Lead** | Detalhes, edição de `phone/website/fullAddress`, notas internas (criar/editar), log de contactos e link `https://wa.me/<telefone>` (`server/routers.ts:255`). |
| **Dashboard** | Métricas `total` + `byStatus` e gráfico doughnut `Chart.js` com corte 76% (`client/src/App.tsx:177`). |
| **Exportação** | `leads.export` gera CSV com BOM ou XLSX com `ExcelJS`, colunas fixas, nome `leads-YYYY-MM-DD.*` (`server/routers.ts:298`). |
| **Configurações** | Atualização de `name/email` e troca de palavra-passe com verificação da atual (`server/routers.ts:177`). |
| **Responsivo** | Sidebar colapsável em `820px`, Kanban com scroll horizontal, auth em 2 colunas → 1 coluna (`client/src/index.css:70`). |
| **Preview Dev** | `?preview=dashboard|search|crm|settings` renderiza `AppShell` sem persistir dados (`client/src/App.tsx:408`). |

---

## Stack Técnica

| Camada | Tecnologia |
|--------|------------|
| **Frontend** | React 19, TypeScript 5.9, Vite 7, Tailwind CSS 4 (`@tailwindcss/vite`), Radix UI, `wouter`, `framer-motion`, `recharts`, `chart.js`, `sortablejs`, `sonner` |
| **Backend** | Node 22, Express 4, tRPC 11 (`@trpc/server` + `superjson`), `jose` (JWT), `bcryptjs`, `drizzle-orm` |
| **BD** | PostgreSQL (prod/Render) · `drizzle-kit` para migrações — `drizzle/schema.ts:1`, `drizzle.config.ts:1` |
| **Integrações** | Google Places API (Text Search + Details via `server/_core/map.ts:1`), `json2csv`, `exceljs`, `nanoid` |
| **Tooling** | `pnpm`, `tsx watch`, `esbuild` (bundle server), `vitest` + `jsdom` + `@testing-library/react`, `prettier`, `vite-plugin-manus-runtime` |
| **Infra** | `render.yaml` — Web Service Node + Postgres Free em `frankfurt` (`render.yaml:1`) |

---

## Arquitetura & Estrutura

```
orbital-leads-crm/
├── client/                 # Frontend Vite + React
│   ├── index.html
│   ├── public/             # Assets estáticos + __manus__/debug-collector
│   └── src/
│       ├── App.tsx         # App, AppShell, AuthPage, MetricsChart, Kanban (414 linhas)
│       ├── main.tsx        # Bootstrap React + tRPC + QueryClient
│       ├── index.css       # Design system cósmico (73 linhas, 3 breakpoints)
│       ├── components/     # ui/* (Radix + shadcn), DashboardLayout, ErrorBoundary
│       ├── contexts/       # ThemeContext
│       ├── hooks/          # useAuth, useMobile, usePersistFn
│       └── lib/            # trpc.ts, utils.ts
├── server/                 # Backend Express + tRPC
│   ├── _core/              # index.ts (bootstrap), context.ts, trpc.ts, cookies.ts,
│   │                       # env.ts, sdk.ts, map.ts (Google Places), oauth.ts, etc.
│   ├── db.ts               # Acesso a dados, tenant isolation, upserts (354 linhas)
│   ├── routers.ts          # appRouter: auth / places / leads (328 linhas)
│   ├── storage.ts
│   └── *.test.ts           # auth.local, tenant-isolation, places-flow, ...
├── drizzle/
│   ├── schema.ts           # pgTable: users, leads, leadNotes, contactLogs, searches
│   └── *.sql               # Migrações geradas
├── shared/
│   └── const.ts            # COOKIE_NAME e constantes partilhadas
├── drizzle.config.ts       # dialect: postgresql
├── vite.config.ts          # alias @ / @shared, plugins, dev server
├── vitest.config.ts
├── render.yaml             # Blueprint Render (web + db)
├── RENDER_DEPLOY.md        # Passo a passo de publicação
├── deployment-research.md  # Referências Render Docs
├── visual-verification.md  # Evidências de validação desktop/mobile
└── package.json            # scripts dev/build/start/check/test/db:push
```

**Fluxo de request**: `client/src/lib/trpc.ts` → `server/_core/trpc.ts` (procedures `publicProcedure`/`protectedProcedure`) → `server/routers.ts` → `server/db.ts` → `pg` Pool → Postgres.

---

## Modelo de Dados

Definido em `drizzle/schema.ts:14`:

| Tabela | Campos principais | Índices |
|--------|-------------------|---------|
| `users` | `id`, `openId` (unique, `local_<uuid>`), `name`, `email` (unique, lowercased), `passwordHash`, `loginMethod`, `role` (`user`/`admin`), `createdAt/updatedAt/lastSignedIn` | `openId`, `email` |
| `leads` | `id`, `tenantId` (FK lógico → `users.openId`), `placeId`, `name`, `phone`, `fullAddress`, `website`, `rating` (`numeric 3,1`), `businessStatus` (`Aberto`/`Fechado`), `status` (enum `PIPELINE_STATUSES`), `segment`, `city`, `state` | `tenant_idx`, `tenant_status_idx`, `tenant_city_idx`, `tenant_place_unique` |
| `leadNotes` | `id`, `tenantId`, `leadId`, `content` (`text`), `createdAt/updatedAt` | `tenant_lead_idx` |
| `contactLogs` | `id`, `tenantId`, `leadId`, `channel`, `details`, `contactedAt` | `tenant_lead_idx` |
| `searches` | `id`, `tenantId`, `segment`, `city`, `state`, `resultCount`, `createdAt` | `tenant_created_idx` |

`PIPELINE_STATUSES` (`drizzle/schema.ts:14`):

```ts
["Novo", "Contatado", "Em Negociação", "Fechado", "Perdido"] as const
```

Upsert de leads usa `onConflictDoUpdate` em `(tenantId, placeId)` — reimportar o mesmo `place_id` atualiza dados sem duplicar (`server/db.ts:200`).

---

## API (tRPC)

Router raiz em `server/routers.ts:131`. Todas as rotas protegidas exigem cookie JWT válido (`protectedProcedure` em `server/_core/trpc.ts:1`).

### `auth`

| Procedure | Tipo | Input | Descrição |
|-----------|------|-------|-----------|
| `auth.me` | `query` | — | Retorna `safeUser` ou `null` |
| `auth.register` | `mutation` | `{ name, email, password }` | Cria `local_<uuid>`, hash bcrypt, seta cookie |
| `auth.login` | `mutation` | `{ email, password }` | Verifica bcrypt, atualiza `lastSignedIn`, seta cookie |
| `auth.logout` | `mutation` | — | `clearCookie(COOKIE_NAME, { maxAge: -1 })` |
| `auth.updateProfile` | `mutation` (protected) | `{ name, email }` | Valida unicidade de email |
| `auth.changePassword` | `mutation` (protected) | `{ currentPassword, newPassword }` | Verifica atual antes de atualizar |

### `places`

| Procedure | Tipo | Input | Descrição |
|-----------|------|-------|-----------|
| `places.search` | `mutation` (protected) | `{ segment, city, state }` | `searchAndCapture` → Google Places → `upsertCapturedLeads` + `createSearchHistory` |
| `places.history` | `query` (protected) | — | Últimas 12 buscas do tenant |
| `places.rerun` | `mutation` (protected) | `{ searchId }` | Reexecuta busca do histórico |

### `leads`

| Procedure | Tipo | Input | Descrição |
|-----------|------|-------|-----------|
| `leads.list` | `query` (protected) | `leadFiltersSchema` | Lista com `status/segment/city/query/selectedIds` |
| `leads.details` | `query` (protected) | `{ leadId }` | Lead + `notes` + `contacts` |
| `leads.updateStatus` | `mutation` (protected) | `{ leadId, status }` | Move no Kanban |
| `leads.updateDetails` | `mutation` (protected) | `{ leadId, phone?, website?, fullAddress? }` | Edita ficha |
| `leads.addNote` | `mutation` (protected) | `{ leadId, content }` | Adiciona nota |
| `leads.updateNote` | `mutation` (protected) | `{ noteId, content }` | Edita nota (valida `tenantId`) |
| `leads.addContact` | `mutation` (protected) | `{ leadId, channel, details? }` | Regista contacto |
| `leads.metrics` | `query` (protected) | — | `{ total, byStatus: { status, count }[] }` |
| `leads.export` | `mutation` (protected) | `{ format: "csv"|"xlsx", filters }` | Retorna `{ filename, mimeType, base64 }` |

Colunas de exportação (`server/routers.ts:118`): `Nome, Telefone, Endereço completo, Website, Avaliação, Status, Status Google, Segmento, Cidade, UF`.

---

## Começando — Desenvolvimento Local

### Pré-requisitos

- **Node.js 22.13.0** (exigido em `render.yaml:16` e engines)
- **pnpm 10.4.1** (`packageManager` em `package.json:120`)
- **PostgreSQL** local ou URL remota
- **Google Maps API Key** com **Places API** ativada

### Instalação

```powershell
# 1. Clonar
git clone https://github.com/azdevcoder/orbital-leads-crm.git
cd orbital-leads-crm

# 2. Instalar dependências (frozen lockfile como no Render)
pnpm install --frozen-lockfile

# 3. Configurar ambiente
Copy-Item .env.example .env  # se existir — ou criar .env manualmente (ver tabela abaixo)

# 4. Aplicar migrações
pnpm drizzle-kit migrate
# ou
pnpm db:push   # generate + migrate

# 5. Rodar em desenvolvimento (tsx watch em server/_core/index.ts)
pnpm dev
# Frontend + API em http://localhost:5173 (ou porta definida em server/_core/index.ts)
```

### Build e Produção

```powershell
pnpm build   # vite build (client → dist/public) + esbuild (server → dist/index.js)
pnpm start   # NODE_ENV=production node dist/index.js
pnpm check   # tsc --noEmit
pnpm format  # prettier --write .
```

---

## Variáveis de Ambiente

| Variável | Obrigatória | Onde | Descrição |
|----------|-------------|------|-----------|
| `DATABASE_URL` | Sim | `drizzle.config.ts:3`, `server/db.ts:42` | Connection string Postgres (`postgres://user:pass@host:5432/db`). No Render vem de `fromDatabase` (`render.yaml:18`). |
| `JWT_SECRET` | Sim | `server/_core/sdk.ts` | Segredo para assinar/verificar JWT via `jose`. No Render é `generateValue: true` (`render.yaml:22`). Local: gere com `openssl rand -base64 32`. |
| `GOOGLE_MAPS_API_KEY` | Sim (para busca) | `server/_core/map.ts:1`, `render.yaml:24` | Chave Google Cloud com Places API. Restringir por IP/servidor. `sync: false` no Render — inserir manualmente no dashboard. |
| `NODE_ENV` | Não | `server/_core/index.ts` | `development` (watch + debug collector) ou `production` (serve `dist/public`). |
| `PORT` | Não | `server/_core/index.ts` | Porta do Express (default do template: `3000`). |
| `VITE_ANALYTICS_*` | Não | `client/index.html` | Endpoint/ID do Umami (opcional). |

> **Nunca** commitar `.env` — já está em `.gitignore:10`. No Render, configurar segredos no dashboard; eles são injetados no próximo deploy.

Exemplo `.env`:

```ini
DATABASE_URL=postgres://orbital_leads:senha@localhost:5432/orbital_leads
JWT_SECRET=troque-por-um-segredo-com-32+-caracteres-aleatorios
GOOGLE_MAPS_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NODE_ENV=development
```

---

## Scripts

| Comando | O que faz |
|---------|-----------|
| `pnpm dev` | `NODE_ENV=development tsx watch server/_core/index.ts` — HMR + API |
| `pnpm build` | `vite build && esbuild server/_core/index.ts --platform=node --packages=external --bundle --format=esm --outdir=dist` |
| `pnpm start` | `NODE_ENV=production node dist/index.js` |
| `pnpm check` | `tsc --noEmit` — verificação de tipos |
| `pnpm format` | `prettier --write .` (`.prettierrc` + `.prettierignore`) |
| `pnpm test` | `vitest run` (jsdom) |
| `pnpm db:push` | `drizzle-kit generate && drizzle-kit migrate` |

---

## Testes

```powershell
pnpm test                # roda todos os testes
pnpm test -- --watch     # modo watch
pnpm test -- auth.local  # filtro por arquivo
```

Cobertura atual (`server/*.test.ts` + `client/src/*.test.tsx`):

- `auth.local.test.ts` — registo/login, hash, conflitos
- `auth.logout.test.ts` — limpeza de cookie
- `tenant-isolation.test.ts` — garante que `listLeads`/`updateStatus` não cruzam tenants
- `search-history-flow.test.ts` — criação, listagem e `rerun` por tenant
- `lead-modal-flow.test.ts` — details/notes/contacts por tenant
- `places-flow.test.ts` — normalização de `businessStatus`, fallback de detalhes
- `client/src/App.navigation.test.tsx` — sidebar com 4 itens obrigatórios
- `client/src/App.integration.test.tsx` — navegação + modal + export + Kanban sem persistir dados

---

## Deploy no Render

Infraestrutura como código via `render.yaml:1` (Blueprint):

- **Web Service** `orbital-leads-crm` — `runtime: node`, `region: frankfurt`, `plan: free`
  - `buildCommand: pnpm install --frozen-lockfile && pnpm build`
  - `preDeployCommand: pnpm drizzle-kit migrate`
  - `startCommand: pnpm start`
  - `healthCheckPath: /`
- **Postgres** `orbital-leads-db` — `region: frankfurt`, `databaseName: orbital_leads`

### Passo a passo (resumo de `RENDER_DEPLOY.md:1`)

1. No Render: **New → Blueprint** → conectar o repositório `azdevcoder/orbital-leads-crm`.
2. Confirmar `render.yaml`. Quando solicitado, preencher `GOOGLE_MAPS_API_KEY` (Places API ativada no Google Cloud, restrita ao servidor).
3. Aguardar criação do Postgres + Web Service. O `preDeployCommand` aplica o schema antes do primeiro arranque.
4. Abrir a URL do serviço, criar uma conta local e executar uma busca de teste (`Segmento + Cidade + UF`).

> Detalhes completos e referências oficiais em [`RENDER_DEPLOY.md`](./RENDER_DEPLOY.md) e [`deployment-research.md`](./deployment-research.md).

---

## Design System / UI

Definido em `client/src/index.css:1` — tema **dark** forçado (`color-scheme: dark`):

- **Paleta**: `--cyan: #55ecff`, `--violet: #a984ff`, `--ink: #07091c`, `--panel: rgba(17,20,56,.72)`, `--line: rgba(168,181,255,.16)`
- **Tipografia**: `Space Grotesk` (corpo) + `Orbitron` (títulos/eyebrows)
- **Efeitos**: `panel-glass` (blur 18px + gradiente), `cosmic-primary` (gradiente ciano→violeta), orbs/nebulosas, estrelas via `radial-gradient`, radar com `rotateSweep` 5s linear
- **Componentes**: Radix UI (Dialog, Select, Tabs, etc.) + Tailwind 4 + `tw-animate-css` + `class-variance-authority`
- **Breakpoints**: `1050px` (dashboard 2→1 coluna), `820px` (sidebar → drawer + overlay), `530px` (cards empilhados)

---

## Segurança e Isolamento por Tenant

- **Hash**: `bcryptjs` cost 12 (`server/routers.ts:148`).
- **Sessão**: JWT via `jose`, cookie `httpOnly`, `secure`, `sameSite: none` com `maxAge` 30 dias (`server/routers.ts:32`). `auth.logout` limpa com `maxAge: -1`.
- **Isolamento**: helper `leadConditions` (`server/db.ts:142`) sempre inclui `eq(leads.tenantId, tenantId)`; `getLeadById`/`getLeadDetails`/`updateLeadNote` validam `tenantId` antes de qualquer escrita.
- **Validação**: `zod` em todos os inputs tRPC (`z.string().trim().max(160)`, `z.enum(PIPELINE_STATUSES)`, etc.) — `server/routers.ts:15`.
- **Google Places**: chamada server-side via `makeRequest` (`server/_core/map.ts:1`); a chave nunca vai para o client.

---

## Verificação Visual

Registada em [`visual-verification.md`](./visual-verification.md):

- Auth (desktop + 375×812 mobile): composição cósmica, hierarquia Orbital Leads, contraste de formulário validado em 21/08/2026.
- Painel autenticado: 4 itens de navegação obrigatórios (Dashboard, Buscar Leads, Meu CRM, Configurações) + estética de gradiente/estrelas/radar/orbs.
- Preview dev (`?preview=...`) usado para validar telas sem persistir dados — sidebar, filtros, exportações e painel de segurança.

---

## Roadmap

Itens pendentes de `todo.md:32`:

- [ ] Validar runtime/auth/BD/Google Places fora da plataforma atual
- [ ] Preparar documentação final de publicação no Render
- [ ] Configurar Web Service + Postgres no Render a partir do GitHub
- [ ] Validar URL externa publicada
- [ ] Migrar adaptador Drizzle MySQL → Postgres gerido (concluído em `drizzle/schema.ts:14` + `drizzle.config.ts:11`)
- [ ] Substituir proxy interno de Google Places por chamadas diretas com `GOOGLE_MAPS_API_KEY` no Render

---

## Licença

MIT — ver `package.json:5`. Livre para uso comercial, modificação e distribuição com preservação do aviso de licença.

---

<p align="center">
  Feito para prospecção que não perde órbita. <br/>
  <strong>Orbital Leads</strong> · Prospecção B2B em órbita.
</p>
