import { ArrayMap } from "array-map-set";
import IStore from './IStore';

export default class MemoryStore implements IStore {
  private store: Map<Uint8Array, Uint8Array>;

  public constructor() {
    this.store = ArrayMap<Uint8Array, Uint8Array>();
  }

  public async add(encoding: Uint8Array, offset: Uint8Array): Promise<void> {
    this.store.set(offset, encoding);
  }

  public async get(offset: Uint8Array): Promise<Uint8Array | undefined> {
    return this.store.get(offset);
  }

  public async del(offset: Uint8Array): Promise<void> {
    this.store.delete(offset);
  }

  public async close(): Promise<void> {
    this.store.clear();
  }
}
