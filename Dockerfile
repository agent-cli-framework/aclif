# Standalone image, built from the repository root:
#   docker build -t aclif .
#   docker run --rm aclif discover
# Embedding hosts that vendor this repository keep their own Dockerfile.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY scripts/gen-provider-index.mjs scripts/
RUN npm ci --omit=dev

FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* tsconfig.json ./
COPY scripts/ scripts/
COPY src/ src/
COPY bin/ bin/
RUN npm ci && npm run build && npx oclif manifest

FROM node:22-alpine AS runner
WORKDIR /app
RUN addgroup -g 1001 -S aclif && adduser -S aclif -u 1001 -G aclif
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/bin ./bin
COPY schemas/ ./schemas/
COPY --from=builder /app/package.json /app/oclif.manifest.json ./
USER aclif
ENTRYPOINT ["node", "bin/run.js"]
