# Backend Dockerfile — multi-stage build
# Stage 1 (builder): compiles native Python extensions with build-essential
# Stage 2 (dev):     retains toolchain for dev containers (uv sync at startup)
# Stage 3 (runtime): clean image without compiler toolchain for production

# UV source image (override for restricted networks that cannot reach ghcr.io)
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.7.20
FROM ${UV_IMAGE} AS uv-source

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM python:3.12-slim-bookworm AS builder

ARG NODE_MAJOR=22
ARG UV_INDEX_URL
# Optional extras to install (e.g. "postgres" for PostgreSQL support)
# Usage: docker build --build-arg UV_EXTRAS=postgres ...
ARG UV_EXTRAS

# Use Chinese mirror (Aliyun) by default
RUN set -e; \
    if [ -f /etc/apt/sources.list.d/debian.sources ]; then \
      sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com/debian-security|g' /etc/apt/sources.list.d/debian.sources; \
    elif [ -f /etc/apt/sources.list ]; then \
      sed -i 's|deb.debian.org|mirrors.aliyun.com|g; s|security.debian.org|mirrors.aliyun.com/debian-security|g' /etc/apt/sources.list; \
    fi

# Install build tools + Node.js (build-essential needed for native Python extensions)
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl build-essential gnupg ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    mkdir -p /etc/apt/keyrings && \
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list && \
    apt-get update && \
    apt-get install -y --no-install-recommends nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install uv (source image overridable via UV_IMAGE build arg)
COPY --from=uv-source /uv /uvx /usr/local/bin/

# Set working directory
WORKDIR /app

# Copy backend source code
COPY backend ./backend

# Install dependencies with cache mount
# When UV_EXTRAS is set (e.g. "postgres"), installs optional dependencies.
RUN --mount=type=cache,target=/root/.cache/uv \
    sh -c "cd backend && UV_INDEX_URL=${UV_INDEX_URL:-https://pypi.org/simple} uv sync ${UV_EXTRAS:+--extra $UV_EXTRAS}"

# ── Stage 2: Dev ──────────────────────────────────────────────────────────────
# Retains compiler toolchain from builder so startup-time `uv sync` can build
# source distributions in development containers.
FROM builder AS dev

# Install Docker CLI (for DooD: allows starting sandbox containers via host Docker socket)
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker

EXPOSE 8001 2024

CMD ["sh", "-c", "cd backend && PYTHONPATH=. uv run uvicorn app.gateway.app:app --host 0.0.0.0 --port 8001"]

# ── Stage 3: Runtime ──────────────────────────────────────────────────────────
# Clean image without build-essential — reduces size (~200 MB) and attack surface.
FROM python:3.12-slim-bookworm

# Copy Node.js runtime from builder (provides npx for MCP servers)
COPY --from=builder /usr/bin/node /usr/bin/node
COPY --from=builder /usr/lib/node_modules /usr/lib/node_modules
RUN ln -s ../lib/node_modules/npm/bin/npm-cli.js /usr/bin/npm \
    && ln -s ../lib/node_modules/npm/bin/npx-cli.js /usr/bin/npx

# Install Docker CLI (for DooD: allows starting sandbox containers via host Docker socket)
COPY --from=docker:cli /usr/local/bin/docker /usr/local/bin/docker

# Install uv (source image overridable via UV_IMAGE build arg)
COPY --from=uv-source /uv /uvx /usr/local/bin/

# Set working directory
WORKDIR /app

# Copy backend with pre-built virtualenv from builder
COPY --from=builder /app/backend ./backend

# Expose ports (gateway: 8001, langgraph: 2024)
EXPOSE 8001 2024

# Default command (can be overridden in docker-compose)
CMD ["sh", "-c", "cd backend && PYTHONPATH=. uv run --no-sync uvicorn app.gateway.app:app --host 0.0.0.0 --port 8001"]
