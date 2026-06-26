# AppTok backend — runs the Fastify server via tsx (no build step).
FROM node:22-slim

WORKDIR /app

# curl/git/ca-certs needed to install the cursor-agent CLI and for it to run.
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates git \
  && rm -rf /var/lib/apt/lists/*

# Install the Cursor CLI so the deployed server can do REAL Cursor builds.
# Installs to /root/.local/bin (cursor.ts prepends ~/.local/bin to PATH on spawn).
RUN curl https://cursor.com/install -fsS | bash
ENV PATH="/root/.local/bin:${PATH}"

# Install all deps (tsx is needed at runtime to execute the TS entrypoint).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    CURSOR_ENABLED=true

EXPOSE 8787

# Graceful: the server handles SIGINT/SIGTERM and closes the MCP connection.
CMD ["npm", "start"]
