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
# the final image is built from /app/dist alone, so the key never reaches it.
ARG RXRESUME_URL
ARG RXRESUME_API_KEY
ARG RXRESUME_ID_FR
ARG RXRESUME_ID_EN

# Refresh the resume data when a key is given. If RxResume is down or the sync fails,
# build with the committed JSON instead of breaking the deploy.
RUN if [ -n "$RXRESUME_API_KEY" ]; then \
      npm run sync:resume || echo "WARNING: resume sync failed, building with the committed resume data"; \
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
