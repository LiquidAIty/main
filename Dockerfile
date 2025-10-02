# Node-only container. Builds client/ and backend, then runs backend on :4000.
FROM node:20-alpine AS build
WORKDIR /app

# Backend deps + build
COPY apps/backend/package*.json apps/backend/
RUN npm --prefix apps/backend ci || true
COPY apps/backend/ apps/backend/
# Try project build, else fall back to TypeScript compile
RUN npm --prefix apps/backend run build || npx -y typescript -p apps/backend || true

# Frontend deps + build (Vite/React)
COPY client/package*.json client/
RUN npm --prefix client ci
COPY client/ client/
RUN npm --prefix client run build

# -------- Runtime --------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000

# Install backend production deps
COPY apps/backend/package*.json apps/backend/
RUN npm --prefix apps/backend ci --omit=dev

# Copy backend runtime files (built JS) and any runtime assets
COPY --from=build /app/apps/backend /app/apps/backend

# Place built SPA where backend serves static files (public/)
# If your backend serves a different folder, it will still find these in apps/backend/public
RUN mkdir -p /app/apps/backend/public
COPY --from=build /app/client/dist/ /app/apps/backend/public/

EXPOSE 4000
CMD ["node","apps/backend/dist/main.js"]
