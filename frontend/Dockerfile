FROM node:22-alpine AS base

# ── deps stage ────────────────────────────────────────────────────────────────
FROM base AS deps
RUN corepack enable pnpm
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ── build stage ───────────────────────────────────────────────────────────────
FROM base AS builder
RUN corepack enable pnpm
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time public env vars (non-secret, baked into the JS bundle)
ARG NEXT_PUBLIC_LIVEKIT_URL
ARG NEXT_PUBLIC_SPATIALREAL_APP_ID
ARG NEXT_PUBLIC_SPATIALREAL_AVATAR_ID
ENV NEXT_PUBLIC_LIVEKIT_URL=$NEXT_PUBLIC_LIVEKIT_URL
ENV NEXT_PUBLIC_SPATIALREAL_APP_ID=$NEXT_PUBLIC_SPATIALREAL_APP_ID
ENV NEXT_PUBLIC_SPATIALREAL_AVATAR_ID=$NEXT_PUBLIC_SPATIALREAL_AVATAR_ID

RUN pnpm build

# ── runtime stage ─────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
