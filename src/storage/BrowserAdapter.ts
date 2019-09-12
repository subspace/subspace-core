import leveljs = require('level-js');
// tslint:disable: no-console
// tslint:disable-next-line: no-implicit-dependencies
import levelup from 'levelup';
import IAdapter from "./IAdapter";

export default class BrowserAdapter implements IAdapter {
  public db: ReturnType<typeof levelup>;

  /**
   * ...
   * To save future headache when dealing with nuances of node <-> browser <> index db for buffer <> Unit8array ...
   * This library will accept keys and values as Uint8Arrays
   * The value is retrievable from the Uint8Array key
   * The value returned will be a buffer
   * Uint8Array.from(buffer) will not convert it back to a Uint8Array
   * Instead call new Uint8Array(buffer)
   * ...
   */

  public constructor(path: string) {
    this.db = levelup(leveljs(path));
  }

  public async put(key: Uint8Array, value: Uint8Array): Promise<void> {
    await this.db.put(key, value);
  }

  public async get(key: Uint8Array): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await this.db.get((key)));
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
          keys.push(new Uint8Array(key));
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
      await this.db.close();
    } catch (error) {
      throw error;
    }
  }
}
