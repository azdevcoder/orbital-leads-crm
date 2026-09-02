# Orbital Leads CRM - Dockerfile
FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY package.json ./
# drizzle-kit precisa estar disponível para migrate
COPY --from=deps /app/node_modules/.pnpm ./node_modules/.pnpm
EXPOSE 3000
CMD sh -c "pnpm drizzle-kit migrate && node dist/index.js"
