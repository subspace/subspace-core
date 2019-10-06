import * as path from 'path';
import {PIECE_SIZE} from "../main/constants";
import {num2Bin} from "../utils/utils";
import DiskStore from "./DiskStore";
import IndexedDBStore from './IndexedDBStore';
import IStore from "./IStore";
import MemoryStore from './MemoryStore';
import RocksStore from './RocksStore';

export class Plot {
  public static readonly ADAPTER_MEM_DB = 'mem-db';
  public static readonly ADAPTER_DISK_DB = 'disk-db';
  public static readonly ADAPTER_INDEXED_DB = 'indexed-db';
  public static readonly ADAPTER_ROCKS_DB = 'rocks-db';

  /**
   * Opens a new plot. Will open an existing plot if rocks or disk storage with same path as previous plot.
   */
  public static async open(
    adapterName: typeof Plot.ADAPTER_MEM_DB | typeof Plot.ADAPTER_DISK_DB | typeof Plot.ADAPTER_INDEXED_DB | typeof Plot.ADAPTER_ROCKS_DB,
    storageDir: string,
    index: number,
    size: number,
    address: Uint8Array,
  ): Promise<Plot> {
    const plotPath = `plot-${index}`;
    let store: IStore | undefined;
    switch (adapterName) {
      case Plot.ADAPTER_MEM_DB:
        store = new MemoryStore();
        break;
      case Plot.ADAPTER_DISK_DB: {
        const storagePath = path.join(storageDir, plotPath);
        store = await DiskStore.create(storagePath, size);
        break;
      }
      case Plot.ADAPTER_ROCKS_DB: {
        const storagePath = path.join(storageDir, plotPath);
        store = new RocksStore(path.normalize(storagePath));
        break;
      }
      case Plot.ADAPTER_INDEXED_DB:
        store = new IndexedDBStore(plotPath);
        break;
      default:
        throw new Error(`Incorrect adapter name ${adapterName}`);
    }
    return new Plot(store, size, address);
  }

  public readonly size: number;
  public readonly maxOffset: number;
  public readonly address: Uint8Array;
  private store: IStore;

  /**
   * @param store
   * @param size
   * @param address
   */
  constructor(
    store: IStore,
    size: number,
    address: Uint8Array,
  ) {
    this.store = store;
    this.size = size;
    this.maxOffset = Math.floor(this.size / PIECE_SIZE);
    this.address = address;
  }

  /**
   * Adds a new encoded piece to the plot, returning an offset.
   *
   * @param encoding  new encoded piece -- always 4096 bytes
   * @param offset    index at which to add encoding to the plot
   */
  public async addEncoding(encoding: Uint8Array, offset: number): Promise<void> {
    return this.store.add(encoding, num2Bin(offset));
  }

  /**
   * Returns an encoded piece, given an offset.
   *
   * @param offset the index of the encoded piece within the plot
   */
  public async getEncoding(offset: number): Promise<Uint8Array> {
    const encoding = await this.store.get(num2Bin(offset));
    if (!encoding) {
      throw new Error('Cannot get encoding, is not in plot');
    }
    return encoding;
  }

  /**
   * Deletes an encoding, freeing the offset for a new piece
   *
   * @param offset The index for this encoding with the plot
   *
   */
  public async deleteEncoding(offset: number): Promise<void> {
    return this.store.del(num2Bin(offset));
  }

  /**
   * Replaces an existing encoded piece with a new one at the same offset.
   *
   * @param encoding  The new encoded piece
   * @param offset    The index for this encoding within the plot
   */
  public async replaceEncoding(encoding: Uint8Array, offset: number): Promise<void> {
    await this.deleteEncoding(offset);
    await this.addEncoding(encoding, offset);
  }

  /**
   * Closes the underlying store to prevent IO errors
   */
  public async close(): Promise<void> {
    return this.store.close();
  }

  /**
   * Deletes all encodings for this plot
   */
  public async delete(range: number): Promise<void> {
    for (let i = 0; i < range; ++i) {
      await this.deleteEncoding(i);
    }
  }
}
