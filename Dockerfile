FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public
ENV NODE_ENV=production DATA_DIR=/data NODE_NO_WARNINGS=1
USER node
CMD ["node", "server/server.js"]
