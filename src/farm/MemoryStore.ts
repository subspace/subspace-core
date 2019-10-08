import IStore from './IStore';

export default class MemoryStore implements IStore {
  private store = new Map<number, Uint8Array>();

  public async add(encoding: Uint8Array, offset: number): Promise<void> {
    this.store.set(offset, encoding);
  }

  public async get(offset: number): Promise<Uint8Array | undefined> {
    return this.store.get(offset);
  }

  public async del(offset: number): Promise<void> {
    this.store.delete(offset);
  }

  public async close(): Promise<void> {
    this.store.clear();
  }
}
