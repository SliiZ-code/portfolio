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

# Resume sync settings (Coolify "build variables"). They only exist in this stage: the final image
# is built from /app/dist alone. The keys are BuildKit secret mounts, not ARGs, so they stay out of
# the image history and the build cache.
ARG RXRESUME_URL
ARG RXRESUME_ID
ARG TRANSLATE_CLAUDE_MODEL
ARG TRANSLATE_GEMINI_MODEL
ARG TRANSLATE_OPENROUTER_MODEL

# Refresh the resume data, the English translation and the CV PDFs when the RxResume key is given.
# The first translation provider with a key wins (claude, then gemini, then openrouter). If RxResume
# or the translation fails, build with the committed or already synced files instead of breaking the deploy.
RUN --mount=type=secret,id=RXRESUME_API_KEY,env=RXRESUME_API_KEY \
    --mount=type=secret,id=CLAUDE_CODE_OAUTH_TOKEN,env=CLAUDE_CODE_OAUTH_TOKEN \
    --mount=type=secret,id=GEMINI_API_KEY,env=GEMINI_API_KEY \
    --mount=type=secret,id=OPENROUTER_API_KEY,env=OPENROUTER_API_KEY \
    if [ -n "$RXRESUME_API_KEY" ]; then \
      npm run sync:resume || echo "WARNING: resume sync failed, building with the committed or already synced files"; \
    else \
      echo "RXRESUME_API_KEY not set, building with the committed resume data"; \
    fi; \
    rm -rf "$HOME/.claude" "$HOME/.claude.json"

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
