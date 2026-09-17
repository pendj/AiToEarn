ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false && npm cache clean --force
COPY gateway ./gateway
USER node
CMD ["node", "gateway/server.mjs"]
