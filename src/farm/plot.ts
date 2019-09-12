import * as path from 'path';
import { PIECE_SIZE } from "../main/constants";
import { num2Bin } from "../utils/utils";
import IndexedDBStore from './IndexedDBStore';
import IStore from "./IStore";
import MemoryStore from './MemoryStore';
import RocksStore from './RocksStore';

export class Plot {

  /**
   * Opens a new plot. Will open an existing plot if rocks or disk storage with same path as previous plot.
   */
  public static open(type: string, storageDir: string, index: number, size: number, address: Uint8Array): Plot {
    const plot = new Plot(type, storageDir, index, size, address);
    return plot;
  }

  public readonly type: string;
  public readonly index: number;
  public readonly size: number;
  public readonly maxOffset: number;
  public readonly address: Uint8Array;
  private store: IStore;

  constructor(type: string, storageDir: string, index: number, size: number, address: Uint8Array) {
    this.type = type;
    this.index = index;
    this.size = size;
    this.maxOffset = Math.floor(this.size / PIECE_SIZE);
    this.address = address;
    const plotPath = `plot-${this.index}`;
    switch (type) {
      case 'mem-db':
        this.store = new MemoryStore();
        break;
      case 'disk-db':
        const storagePath = path.join(storageDir, plotPath);
        this.store = new RocksStore(path.normalize(storagePath));
        break;
      case 'indexed-db':
        this.store = new IndexedDBStore(plotPath);
        break;
      default:
        this.store = new MemoryStore();
        break;
    }
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
    const encoding =  await this.store.get(num2Bin(offset));
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
