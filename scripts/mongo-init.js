const fs = require('fs');
const config = JSON.parse(fs.readFileSync('/run/private/mongodb.json', 'utf8'));
let admin;
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    admin = new Mongo('mongodb://mongodb:27017/?directConnection=true').getDB('admin');
    if (admin.auth('admin', config.mongoRootPassword).ok === 1) break;
  } catch {}
  admin = null;
  sleep(1500);
}
if (!admin) throw new Error('MongoDB did not become available');
const status = admin.runCommand({ replSetGetStatus: 1 });
if (status.code === 94) {
  const result = admin.runCommand({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: 'mongodb:27017' }] } });
  if (!result.ok) throw new Error('Replica set initialization failed');
} else if (!status.ok) throw new Error('Unexpected replica set status');
let primary = false;
for (let attempt = 0; attempt < 40; attempt++) {
  if (admin.runCommand({ hello: 1 }).isWritablePrimary) { primary = true; break; }
  sleep(1000);
}
if (!primary) throw new Error('Primary election did not finish');
if (!admin.getUser('aitoearn')) {
  admin.createUser({ user: 'aitoearn', pwd: config.mongoAppPassword, roles: [
    { role: 'readWrite', db: 'aitoearn' }, { role: 'readWrite', db: 'aitoearn_channel' },
  ] });
}
const users = admin.getSiblingDB('aitoearn').getCollection('user');
const id = ObjectId(config.operatorId);
if (!users.findOne({ _id: id })) {
  if (users.findOne({ mail: 'operator@luxsabers.local' })) throw new Error('Existing operator identity conflict');
  const now = new Date();
  users.insertOne({ _id: id, name: 'LuxSabers Operator', mail: 'operator@luxsabers.local',
    status: 1, userType: 'CREATOR', isDelete: false, score: 0, usedStorage: 0,
    storage: { total: 536870912 }, locale: 'en-US', createdAt: now, updatedAt: now });
}
print('Private databases and operator initialized; no automatic login token created.');
