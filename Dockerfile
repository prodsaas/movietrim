# Build the app
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --production

# Create production environment
FROM node:22-alpine
WORKDIR /app

RUN apk update && apk add --no-cache ffmpeg ttf-dejavu fontconfig

COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

RUN mkdir -p upload

ENV BODY_SIZE_LIMIT=Infinity
ENV PORT=5000

EXPOSE 5000

CMD ["node", "build/index.js"]