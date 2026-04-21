FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

# Copy source
COPY server/ ./server/
COPY public/ ./public/
COPY bridge/ ./bridge/

# Data directory for SQLite
RUN mkdir -p /data

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "server/index.js"]
