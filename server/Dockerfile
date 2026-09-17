ARG SERVER_IMAGE
FROM ${SERVER_IMAGE}
USER root
COPY scripts/patch-native-retry.mjs /tmp/patch-native-retry.mjs
RUN node /tmp/patch-native-retry.mjs /app/apps/aitoearn-server/src/core/channels/publish/tasks/publish-task.service.js
USER node
