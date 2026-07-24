# Perch — one-command self-host.
# Build:  docker build -t perch .
# Run:    docker run -p 8787:8787 -e PERCH_BASE_URL=https://tools.yourco.com \
#                    -e PERCH_SECRET=$(openssl rand -hex 24) \
#                    -e PERCH_TRUSTED_PROXY_HEADER=x-forwarded-email \
#                    -v perch-data:/app/.perch-data perch
#
# The sandbox forks child processes, so Perch needs a real container/VM host
# (Cloud Run, Fly, Render, a VM) — not a function/edge runtime.

FROM node:22-slim

WORKDIR /app

# Install deps first for layer caching. tsx is a runtime dependency (no build step).
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY . .

# Persist the control-plane DB across restarts (bind a volume here).
RUN mkdir -p /app/.perch-data
ENV NODE_ENV=production \
    PORT=8787 \
    PERCH_DB=/app/.perch-data/perch.db

EXPOSE 8787
CMD ["npm", "start"]
