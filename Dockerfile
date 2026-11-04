# syntax=docker/dockerfile:1
# Build stage
FROM node:24-bookworm-slim AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# RxResume sync settings (Coolify "build variables"). They only exist in this stage:
# the final image is built from /app/dist alone. The key is a build secret, not an ARG,
# so it stays out of the image history and the build cache.
ARG RXRESUME_URL
ARG RXRESUME_ID_FR
ARG RXRESUME_ID_EN
ARG RXRESUME_PDF_ID_FR
ARG RXRESUME_PDF_ID_EN

# Refresh the resume data (and the CV PDFs, when their IDs are given) when a key is given.
# If RxResume is down or the sync fails, build with the committed files instead of breaking
# the deploy.
RUN --mount=type=secret,id=RXRESUME_API_KEY,env=RXRESUME_API_KEY \
    if [ -n "$RXRESUME_API_KEY" ]; then \
      npm run sync:resume || echo "WARNING: resume sync failed, building with the committed or already synced files"; \
    else \
      echo "RXRESUME_API_KEY not set, building with the committed resume data"; \
    fi

# Build the static site
RUN npm run build

# Runtime stage
FROM caddy:2-alpine

WORKDIR /srv

# Copy the built site from builder
COPY --from=builder /app/dist ./

# Copy Caddyfile
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1/ || exit 1
