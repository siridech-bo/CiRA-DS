FROM node:18-bullseye-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
ENV PORT=80
EXPOSE 80
CMD ["node","server.js"]