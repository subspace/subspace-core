// TODO: Fix typings here
// @ts-ignore
import * as level from 'level-rocksdb';
import IAdapter from './IAdapter';

export default class RocksAdapter implements IAdapter {
  public db: ReturnType<typeof level>;

  public constructor(path: string) {
    this.db = level(path, { valueEncoding: 'binary' });
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
        .on('data', (key: string) => {
          keys.push(Uint8Array.from(key.split(',').map(Number)));
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
