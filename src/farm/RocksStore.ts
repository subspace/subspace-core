// TODO: Fix typings here
// @ts-ignore
import * as level from 'level-rocksdb';
import IStore from './IStore';

export default class RocksStore implements IStore {
  private store: ReturnType<typeof level>;

  public constructor(path: string) {
    this.store = level(path, { valueEncoding: 'binary' });
  }

  public async add(encoding: Uint8Array, offset: Uint8Array): Promise<void> {
    await this.store.put(offset, encoding);
  }

  public async get(offset: Uint8Array): Promise<Uint8Array | null> {
    try {
      return await this.store.get(offset);
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      throw error;
    }
  }

  public async del(offset: Uint8Array): Promise<void> {
    try {
      await this.store.del(offset);
    } catch (error) {
      // Ignore if value already deleted
      if (error.notFound) {
        return;
      }
      throw error;
    }
  }

  public async close(): Promise<void> {
    try {
      await this.store.close();
    } catch (error) {
      throw error;
    }
  }
}
