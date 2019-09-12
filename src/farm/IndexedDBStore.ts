import leveljs = require('level-js');
// tslint:disable: no-console
// tslint:disable-next-line: no-implicit-dependencies
import levelup from 'levelup';
import IStore from './IStore';

export default class IndexedDBStore implements IStore {
  private store: ReturnType<typeof levelup>;

  public constructor(path: string) {
    this.store = levelup(leveljs(path));
  }

  public async add(encoding: Uint8Array, offset: Uint8Array): Promise<void> {
    await this.store.put(offset, encoding);
  }

  public async get(offset: Uint8Array): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await this.store.get(offset));
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
