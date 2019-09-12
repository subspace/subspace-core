// tslint:disable: no-console
if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}

import * as crypto from '../crypto/crypto';
import { areArraysEqual } from '../utils/utils';
import { Storage } from './storage';

const storage = new Storage('browser', 'test', 'browser-test');

const test = async (): Promise<void> => {
  const key = crypto.randomBytes(32);
  const value = Buffer.from('hello');
  console.log(key, value);

  await storage.put(key, value);
  const returnValue = await storage.get(key);
  console.log(returnValue);

  if (!returnValue) {
    throw new Error('failed to get');
  }

  if (!areArraysEqual(value, returnValue)) {
    throw new Error('put and get failed');
  }

  const keys = await storage.getKeys();
  console.log(keys);

  const length = await storage.getLength();
  console.log(length);

  await storage.del(key);
  const deletedValue = await storage.get(key);
  if (deletedValue) {
    throw new Error('deleted failed');
  }

  for (let i = 0; i < 10; ++i) {
    await storage.put(crypto.randomBytes(32), crypto.randomBytes(32));
  }

  const keySet = await storage.getKeys();
  console.log(keySet);

  await storage.clear();

  const deletedKeySet = await storage.getKeys();
  console.log(deletedKeySet);
};

test();
