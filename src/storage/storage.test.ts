if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}

import * as fs from 'fs';
import * as os from 'os';
import * as crypto from '../crypto/crypto';
import { rmDirRecursiveSync } from '../utils/utils';
import { Storage } from './storage';

const v0 = Uint8Array.from(Buffer.from('hello subspace'));
const k0 = crypto.hash(Buffer.from(v0));
const v1 = Uint8Array.from(Buffer.from('value one'));
const k1 = crypto.hash(Buffer.from(v1));
const v2 = Uint8Array.from(Buffer.from('value two'));
const k2 = crypto.hash(Buffer.from(v2));
const v3 = Uint8Array.from(Buffer.from('value three'));
const k3 = crypto.hash(Buffer.from(v3));

const storageTest = (storage: Storage) => {

  test(`${storage.adapterName}-put`, async () => {
    await storage.put(k0, v0);
  });

  test(`${storage.adapterName}-get`, async () => {
    const storedValue = await storage.get(k0);
    if (storedValue) {
      expect(storedValue.join(', ')).toBe(v0.join(', '));
    } else {
      fail(true);
    }
  });

  test(`${storage.adapterName}-del`, async () => {
    await storage.del(k0);
    const storedValue = await storage.get(k0);
    if (storedValue) {
      fail(true);
    }
  });

  test(`${storage.adapterName}-put-get-many`, async () => {
    await storage.put(k1, v1);
    await storage.put(k2, v2);
    await storage.put(k3, v3);
    const sv1 = await storage.get(k1);
    const sv2 = await storage.get(k2);
    const sv3 = await storage.get(k3);
    if (sv1 && sv2 && sv3) {
      expect(sv1.join(', ')).toBe(v1.join(', '));
      expect(sv2.join(', ')).toBe(v2.join(', '));
      expect(sv3.join(', ')).toBe(v3.join(', '));
    } else {
      fail(true);
    }
  });

  test(`${storage.adapterName}-get-keys`, async () => {
    const keys = await storage.getKeys();
    expect(keys.length).toBe(3);
    const stringKeys = keys.map((key) => key.join(', '));
    expect(stringKeys.includes(k1.join(', '))).toBe(true);
    expect(stringKeys.includes(k2.join(', '))).toBe(true);
    expect(stringKeys.includes(k3.join(', '))).toBe(true);
  });

  test(`${storage.adapterName}-get-length`, async () => {
    const length = await storage.getLength();
    expect(length).toBe(3);
  });

  test(`${storage.adapterName}-clear`, async () => {
    await storage.clear();
    const length = await storage.getLength();
    expect(length).toBe(0);
    const sv1 = await storage.get(k1);
    const sv2 = await storage.get(k2);
    const sv3 = await storage.get(k3);
    if (sv1 || sv2 || sv3) {
      fail(true);
    }
    await storage.close();
  });
};

const storageDir = `${os.tmpdir()}/subspace/tests/storage`;

if (fs.existsSync(storageDir)) {
  rmDirRecursiveSync(storageDir);
 }

fs.mkdirSync(storageDir, { recursive: true });

storageTest(new Storage('rocks', storageDir, 'rocks-test'));
storageTest(new Storage('memory', storageDir, 'memory-test'));
storageTest(new Storage('browser', storageDir, 'browser-test'));
