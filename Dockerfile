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
# is built from /app/dist alone. Coolify passes build variables as --build-arg, or, with "Use Docker
# Build Secrets" on, as BuildKit secrets. The sync RUN reads the secrets and falls back to the ARGs
# (plain `docker build --build-arg`). Secrets never become ARGs, so they stay out of the image history.
ARG RXRESUME_URL
ARG RXRESUME_ID
ARG RXRESUME_ID_FR
ARG TRANSLATE_CLAUDE_MODEL
ARG TRANSLATE_GEMINI_MODEL
ARG TRANSLATE_OPENROUTER_MODEL

# Refresh the resume data, the English translation and the CV PDFs when the RxResume key is given.
# The first translation provider with a key wins (claude, then gemini, then openrouter). If RxResume
# or the translation fails, build with the committed or already synced files instead of breaking the deploy.
# Each setting is mounted under a SECRET_ name and used only when it is not empty, so an absent or empty
# secret never blanks the ARG value (and no secret can unset it).
# Cache: the secret mounts are not part of the layer's cache key, so a redeploy of the same commit reuses
# this layer and does not sync. A push changes the source and rebuilds it. The resume autodeploy
# (scripts/check-resume-change.mjs) redeploys with force=true (Coolify builds with no cache) so it always syncs.
RUN --mount=type=secret,id=RXRESUME_API_KEY,env=RXRESUME_API_KEY \
    --mount=type=secret,id=CLAUDE_CODE_OAUTH_TOKEN,env=CLAUDE_CODE_OAUTH_TOKEN \
    --mount=type=secret,id=GEMINI_API_KEY,env=GEMINI_API_KEY \
    --mount=type=secret,id=OPENROUTER_API_KEY,env=OPENROUTER_API_KEY \
    --mount=type=secret,id=RXRESUME_URL,env=SECRET_RXRESUME_URL \
    --mount=type=secret,id=RXRESUME_ID,env=SECRET_RXRESUME_ID \
    --mount=type=secret,id=RXRESUME_ID_FR,env=SECRET_RXRESUME_ID_FR \
    --mount=type=secret,id=TRANSLATE_CLAUDE_MODEL,env=SECRET_TRANSLATE_CLAUDE_MODEL \
    --mount=type=secret,id=TRANSLATE_GEMINI_MODEL,env=SECRET_TRANSLATE_GEMINI_MODEL \
    --mount=type=secret,id=TRANSLATE_OPENROUTER_MODEL,env=SECRET_TRANSLATE_OPENROUTER_MODEL \
    export RXRESUME_URL="${SECRET_RXRESUME_URL:-$RXRESUME_URL}" \
      RXRESUME_ID="${SECRET_RXRESUME_ID:-$RXRESUME_ID}" \
      RXRESUME_ID_FR="${SECRET_RXRESUME_ID_FR:-$RXRESUME_ID_FR}" \
      TRANSLATE_CLAUDE_MODEL="${SECRET_TRANSLATE_CLAUDE_MODEL:-$TRANSLATE_CLAUDE_MODEL}" \
      TRANSLATE_GEMINI_MODEL="${SECRET_TRANSLATE_GEMINI_MODEL:-$TRANSLATE_GEMINI_MODEL}" \
      TRANSLATE_OPENROUTER_MODEL="${SECRET_TRANSLATE_OPENROUTER_MODEL:-$TRANSLATE_OPENROUTER_MODEL}"; \
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
