FROM node:18

WORKDIR /app

COPY backend/package.json ./backend/package.json

WORKDIR /app/backend

RUN npm install

WORKDIR /app

COPY backend ./backend
COPY frontend ./frontend

EXPOSE 3000

CMD ["node", "backend/server.js"]
