import BrowserAdapter from './BrowserAdapter';
import IAdapter from './IAdapter';
import MemoryAdapter from './MemoryAdapter';
import RocksAdapter from './RocksAdapter';

// ToDo
  // close storage (handle error/callback)
  // fix browser storage using level-js: https://github.com/Level/level-js
  // handle JSON storage / type serialization
  // return boolean for del
  // mobile storage

/**
 * A generic persistent storage interface to a simple key-value store that provides a standard interface across host environments. Currently supports node js and browser run times.
 */
export class Storage {
  public static async create(
    adapterName: string,
    nameSpace?: string,
  ): Promise<Storage> {
    let path: string = `${__dirname}/../../data`;
    if (nameSpace) {
      path = path.concat(`/${nameSpace}`);
    }
    switch (adapterName) {
      case 'browser':
        return new Storage(new BrowserAdapter(path));
      case 'rocks':
        return new Storage(new RocksAdapter(path));
      case 'memory':
        return new Storage(new MemoryAdapter());
      default:
        throw new Error('Wrong adapter name, supported adapters: browser, memory, rocks');
    }
  }

  constructor(private readonly adapter: IAdapter) {
  }

  /**
   * Stores a binary value under a binary key.
   */
  public put(key: Uint8Array, value: Uint8Array): Promise<void> {
    return this.adapter.put(key, value);
  }

  /**
   * Returns a binary value given a binary key.
   */
  public get(key: Uint8Array): Promise<Uint8Array | null> {
    return this.adapter.get(key);
  }

  /**
   * Deletes a binary value given a binary key.
   */
  public del(key: Uint8Array): Promise<void> {
    return this.adapter.del(key);
  }

  /**
   * Returns an array of all binary keys for this store.
   */
  public getKeys(): Promise<Uint8Array[]> {
    return this.adapter.getKeys();
  }

  /**
   * Returns the number of records held in this store.
   */
  public getLength(): Promise<number> {
    return this.adapter.getLength();
  }

  /**
   * Deletes all records from this store.
   */
  public clear(): Promise<void> {
    return this.adapter.clear();
  }

  /**
   * Closes the existing store to prevent IO errors.
   */
  public close(): Promise<void> {
    return this.adapter.close();
  }
}
