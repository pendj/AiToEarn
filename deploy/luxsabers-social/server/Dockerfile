ARG SERVER_IMAGE
FROM ${SERVER_IMAGE}
USER root
COPY scripts/patch-native-retry.mjs /tmp/patch-native-retry.mjs
RUN node /tmp/patch-native-retry.mjs /app/apps/aitoearn-server/src/core/channels/publish/tasks/publish-task.service.js
COPY server/r2-transport.cjs /app/luxsabers/r2-transport.cjs
COPY server/r2-policy.cjs /app/luxsabers/r2-policy.cjs
COPY scripts/patch-r2-transport.mjs /tmp/patch-r2-transport.mjs
RUN node /tmp/patch-r2-transport.mjs /app/libs/aws-s3/src/s3.module.js
USER node
