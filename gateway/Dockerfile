ARG NODE_IMAGE
FROM ${NODE_IMAGE}
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts=false && npm cache clean --force
RUN node -e "require('@fastify/secure-session'); console.log('Native session encryption available')"
COPY gateway ./gateway
COPY automation ./automation
USER node
CMD ["node", "gateway/server.mjs"]
