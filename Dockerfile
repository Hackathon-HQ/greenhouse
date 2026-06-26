# AppTok backend — runs the Fastify server via tsx (no build step).
FROM node:22-slim

# tavily-mcp spawns via npx and the agent shells out; keep image lean but capable.
WORKDIR /app

# Install all deps (tsx is needed at runtime to execute the TS entrypoint).
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    CURSOR_ENABLED=false

EXPOSE 8787

# Graceful: the server handles SIGINT/SIGTERM and closes the MCP connection.
CMD ["npm", "start"]
