// import indexedDB = require("fake-indexeddb");
// tslint:disable-next-line: no-submodule-imports
import * as fidb from 'fake-indexeddb/auto';
import leveljs = require('level-js');
// tslint:disable-next-line: no-implicit-dependencies
import levelup from 'levelup';
import IAdapter from "./IAdapter";

export default class BrowserAdapter implements IAdapter {
  public db: any;

  public constructor(path: string) {
    this.db = levelup(leveljs(path));
  }

  public async put(key: Uint8Array, value: Uint8Array): Promise<void> {
    await this.db.put(key, value);
  }

  public async get(key: Uint8Array): Promise<Uint8Array | null> {
    try {
      return await this.db.get(key);
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      throw error;
    }
  }

  public async del(key: Uint8Array): Promise<void> {
    try {
      await this.db.del(key);
    } catch (error) {
      // Ignore if value already deleted
      if (error.notFound) {
        return;
      }
      throw error;
    }
  }

  public async getKeys(): Promise<Uint8Array[]> {
    return new Promise<Uint8Array[]> (async (resolve) => {
      const keys: Uint8Array[] = [];
      this.db.createKeyStream()
        .on('data', (key: Uint8Array) => {
          keys.push(key);
        })
        .on('end', () => {
          resolve(keys);
        });
    });
  }

  public async getLength(): Promise<number> {
    const keys = await this.getKeys();
    return keys.length;
  }

  public async clear(): Promise<void> {
    const keys = await this.getKeys();
    for (const key of keys) {
      await this.del(key);
    }
  }

  public async close(): Promise<void> {
    try {
      await this.close();
    } catch (error) {
      throw error;
    }
  }
}
