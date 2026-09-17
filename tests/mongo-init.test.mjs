import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../scripts/mongo-init.js', import.meta.url), 'utf8');

function runInitializer(statusError) {
  const commands = [];
  const admin = {
    auth: () => ({ ok: 1 }),
    runCommand(command) {
      commands.push(command);
      if (command.replSetGetStatus && statusError) throw statusError;
      if (command.hello) return { isWritablePrimary: true };
      return { ok: 1 };
    },
    getUser: () => ({ user: 'aitoearn' }),
    getSiblingDB: () => ({ getCollection: () => ({ findOne: () => ({}) }) }),
  };
  runInNewContext(source, {
    require: () => ({ readFileSync: () => JSON.stringify({ mongoRootPassword: 'synthetic', operatorId: 'synthetic' }) }),
    Mongo: class { getDB() { return admin; } },
    ObjectId: value => value, sleep: () => {}, print: () => {},
  });
  return commands;
}

test('first initialization handles mongosh NotYetInitialized exception', () => {
  const commands = runInitializer(Object.assign(new Error('no replset config has been received'), { code: 94 }));
  assert.equal(commands.filter(command => command.replSetInitiate).length, 1);
});

test('existing replica is preserved and other errors are not swallowed', () => {
  assert.equal(runInitializer().filter(command => command.replSetInitiate).length, 0);
  assert.throws(() => runInitializer(Object.assign(new Error('not authorized'), { code: 13 })), /not authorized/);
});
