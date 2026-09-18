try {
  const fs = require('fs');
  const admin = new Mongo('mongodb://127.0.0.1:27017/?directConnection=true').getDB('admin');
  const password = fs.readFileSync('/run/private/mongo-root-password', 'utf8');
  if (admin.auth('admin', password).ok !== 1) quit(1);
  quit(admin.runCommand({ hello: 1 }).isWritablePrimary ? 0 : 1);
} catch { quit(1); }
