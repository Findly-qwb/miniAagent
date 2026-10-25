# ---------- 构建阶段：后端 tsc + 前端 vite ----------
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY web/package.json web/package-lock.json ./web/
RUN npm --prefix web ci
COPY tsconfig.json ./
COPY src ./src
COPY web ./web
RUN npm run build && npm --prefix web run build

# ---------- 运行阶段：仅生产依赖 ----------
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/web/dist ./web/dist
COPY docs ./docs
EXPOSE 3000
CMD ["node", "dist/server/index.js"]
