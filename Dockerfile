# One image for the api, sweeper and migrate services (see docker-compose.yml).
#
# node:22-slim, not node:22-alpine: argon2 (password hashing) is a native addon.
# Its npm package ships prebuilt binaries for glibc Linux (linux-x64, linux-arm64,
# ...) but none for musl, so on Alpine `npm ci` would fall back to compiling it
# with node-gyp, which needs python3, make and g++ in the image. Debian slim is
# glibc, so the prebuilt binary is used and no toolchain is needed.

# --- build: full install (TypeScript is a dev dependency), compile src/ -> dist/
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime: production dependencies + compiled output + SQL migrations only
FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# The app never writes to /app, so root-owned files are fine for the node user.
USER node
EXPOSE 3000
# Exec form, so node is PID 1 and receives SIGTERM from `docker stop` directly
# (an `npm start` wrapper would sit in between and complicate signal delivery).
CMD ["node", "dist/server.js"]
