ARG AI_IMAGE
FROM ${AI_IMAGE}
USER root
COPY server/r2-transport.cjs /app/luxsabers/r2-transport.cjs
COPY server/r2-policy.cjs /app/luxsabers/r2-policy.cjs
COPY scripts/patch-r2-transport.mjs /tmp/patch-r2-transport.mjs
RUN node /tmp/patch-r2-transport.mjs /app/libs/aws-s3/src/s3.module.js
USER node
