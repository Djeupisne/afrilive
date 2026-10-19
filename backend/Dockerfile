# ===== Build =====
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache libc6-compat openssl
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund
COPY . .
RUN npx prisma generate && npm run build

# ===== Runtime =====
FROM node:20-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache tini
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev --no-audit --no-fund && npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 3000
# tini comme PID 1 pour une propagation correcte des signaux (shutdown propre)
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/src/main.js"]
