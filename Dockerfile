FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV HOST=0.0.0.0
ENV PORT=8080

EXPOSE 8080

CMD ["node", "backend/server.js"]
