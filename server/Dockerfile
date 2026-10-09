FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
ENV PORT=3210
EXPOSE 3210
CMD ["npm","start"]