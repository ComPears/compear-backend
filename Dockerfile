FROM node:22.23.4-alpine AS builder

WORKDIR /app
COPY package*.json .npmrc tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22.23.4-alpine

WORKDIR /app
COPY package*.json .npmrc ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

ENV NODE_ENV=production
EXPOSE 4000

CMD ["node", "dist/index.js"]
