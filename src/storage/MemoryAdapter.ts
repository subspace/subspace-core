// @ts-ignore
import IAdapter from './IAdapter';

export default class MemoryAdapter implements IAdapter {
  public db: Map<Uint8Array, Uint8Array>;

  public constructor() {
    this.db = new Map();
  }

  public async put(key: Uint8Array, value: Uint8Array): Promise<void> {
    await this.db.set(key, value);
  }

  public async get(key: Uint8Array): Promise<Uint8Array | null> {
    const value = await this.db.get(key);
    if (value) {
      return value;
    } else {
      return null;
    }
  }

  public async del(key: Uint8Array): Promise<void> {
    await this.db.delete(key);
  }

  public async getKeys(): Promise<Uint8Array[]> {
    return [...this.db.keys()];
  }

  public async getLength(): Promise<number> {
    return this.db.size;
  }

  public async clear(): Promise<void> {
    this.db.clear();
  }

  public async close(): Promise<void> {
    return;
  }
}
