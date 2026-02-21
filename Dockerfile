FROM node:18-bullseye AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

FROM node:18-bullseye-slim

WORKDIR /app

# Install dependencies for better-sqlite3 (though it should be prebuild if possible)
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package*.json ./
RUN npm install --omit=dev --ignore-engines

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.ts ./
COPY --from=builder /app/src ./src
COPY --from=builder /app/types.ts ./types.ts
# Note: server.ts imports from ./types.ts or similar? Let's check imports in server.ts.
# Wait, server.ts doesn't seem to import from src. It should be self-contained.

EXPOSE 3000
CMD ["npm", "start"]
