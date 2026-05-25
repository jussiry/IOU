FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV HOST=0.0.0.0
ENV PORT=8080

RUN npm run build
RUN npm run build:web

EXPOSE 8080

CMD ["node", "server/server.js"]