// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

import { NodeManagerJsUint8Array, Tree } from "@subspace/red-black-tree";
import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { IEncoding, IPiece, IPieceData } from '../main/interfaces';
import { Storage } from '../storage/storage';
import { bin2Num, num2Bin } from "../utils/utils";

// ToDo
  // Plots
    // modes: mem-db, disk-db, raw-disk, on-the-fly
    // manage multiple plots (create, read, update, delete)
  // red-black tree
    // in memory tree
    // disk based tree
    // hybrid tree

/**
 * Manages all plots for this node. Plots store encoded pieces which are used to solve the block challenge.
 */
export class Farm {
  public static readonly MODE_MEM_DB = 'mem-db';
  public static readonly MODE_DISK_DB = 'disk-db';
  /**
   * Returns a new farm instance.
   */
  public static async init(adapter: string, mode: typeof Farm.MODE_MEM_DB | typeof Farm.MODE_DISK_DB): Promise<Farm> {
    if (mode === 'mem-db') {
      adapter = 'memory';
    }
    const storage = new Storage(adapter, `farm-${mode}`);
    const diskPlot = new Storage(adapter, 'plot');
    return new Farm(storage, diskPlot, mode);
  }

  // if we have multiple plots of the same data we don't want to store the metadata each time, so it should be stored separately
    // use plot storage instead to store pieceData

  public address: Uint8Array = new Uint8Array();
  private readonly mode: typeof Farm.MODE_MEM_DB | typeof Farm.MODE_DISK_DB;
  private readonly storage: Storage;
  private readonly memTree: Tree<Uint8Array, number>;
  private readonly memPlot: Map<number, Uint8Array> = new Map();
  private readonly diskPlot: Storage;
  private pieceOffset = 0;

  constructor(storage: Storage, diskPlot: Storage, mode: typeof Farm.MODE_MEM_DB | typeof Farm.MODE_DISK_DB) {
    this.mode = mode;
    this.storage = storage;
    this.diskPlot = diskPlot;
    const nodeManager = new NodeManagerJsUint8Array<number>();
    this.memTree = new Tree(nodeManager);
  }

  /**
   * Adds a new encoded piece to plot, index, and metadata store.
   */
  public async addPiece(piece: Uint8Array, pieceData: IPieceData): Promise<void> {
    const encodedPiece = codes.encodePiece(piece, this.address);
    this.pieceOffset ++;

    switch (this.mode) {
      case Farm.MODE_MEM_DB:
        this.memPlot.set(this.pieceOffset, encodedPiece);
        break;
      case Farm.MODE_DISK_DB:
        await this.diskPlot.put(num2Bin(this.pieceOffset), encodedPiece);
        break;
    }

    this.memTree.addNode(pieceData.pieceHash, this.pieceOffset);
    await this.addPieceData(pieceData);
    // console.log(`[+] Finished plotting encoding ${bin2Hex(crypto.hash(encodedPiece)).substring(0, 16)} from piece ${bin2Hex(pieceData.pieceHash).substring(0, 16)}.`);
  }

  public getSize(): number {
    return this.memPlot.size;
  }

  /**
   * Searches index for closest piece id to target by XOR and returns the decoded piece with metadata.
   */
  public async getClosestPiece(target: Uint8Array): Promise<IPiece | void> {
    const node = this.memTree.getClosestNode(target);
    if (node) {
      const [pieceHash, offset] = node;
      let encoding: Uint8Array | null | undefined;
      switch (this.mode) {
        case Farm.MODE_MEM_DB:
          encoding = this.memPlot.get(offset);
          break;
        case Farm.MODE_DISK_DB:
          encoding = await this.diskPlot.get(num2Bin(offset));
          break;
      }
      if (encoding) {
        const piece = codes.decodePiece(encoding, this.address);
        const data = await this.getPieceData(pieceHash);
        return { piece, data };
      }
    }
  }

  /**
   * Searches the index for exact match based on piece id and returns the decoded piece with metadata.
   */
  public async getExactPiece(pieceId: Uint8Array): Promise<IPiece | void> {
    const offset = this.memTree.getNodeValue(pieceId);
    if (offset) {
      let encoding: Uint8Array | null | undefined;
      switch (this.mode) {
        case Farm.MODE_MEM_DB:
          encoding = this.memPlot.get(offset);
          break;
        case Farm.MODE_DISK_DB:
          encoding = await this.diskPlot.get(num2Bin(offset));
          break;
      }
      if (encoding) {
        const piece = codes.decodePiece(encoding, this.address);
        const pieceHash = crypto.hash(piece);
        if (pieceHash.toString() === pieceId.toString()) {
          const data = await this.getPieceData(pieceId);
          return { piece, data };
        }
      }
    }
  }

  /**
   * Searches index for closest piece id to target by XOR and returns the associated encoding with metadata.
   */
  public async getClosestEncoding(target: Uint8Array): Promise<IEncoding | void> {
    const node = this.memTree.getClosestNode(target);
    if (node) {
      const [pieceHash, offset] = node;
      let encoding: Uint8Array | null | undefined;
      switch (this.mode) {
        case Farm.MODE_MEM_DB:
          encoding = this.memPlot.get(offset);
          break;
        case Farm.MODE_DISK_DB:
          encoding = await this.diskPlot.get(num2Bin(offset));
          break;
      }
      if (encoding) {
        // console.log(`Got encoding and data for piece ${pieceHash} from farm:`);
        // console.log(encoding);
        const data = await this.getPieceData(pieceHash);
        return { encoding, data };
      }
    }
  }

  /**
   * Searches the index for the exact match based on piece id and returns the associated encoding with metadata.
   */
  public async getExactEncoding(pieceId: Uint8Array): Promise<IEncoding | void> {
    const offset = this.memTree.getNodeValue(pieceId);
    if (offset) {
      let encoding: Uint8Array | null | undefined;
      switch (this.mode) {
        case Farm.MODE_MEM_DB:
          encoding = this.memPlot.get(offset);
          break;
        case Farm.MODE_DISK_DB:
          encoding = await this.diskPlot.get(num2Bin(offset));
          break;
      }
      if (encoding) {
        const data = await this.getPieceData(pieceId);
        return { encoding, data };
      }
    }
  }

  /**
   * Deletes an encoded piece from the plot, index, and metadata store.
   */
  public async removePiece(pieceId: Uint8Array): Promise<void> {
    const offset = this.memTree.getNodeValue(pieceId);
    if (offset) {
      switch (this.mode) {
        case Farm.MODE_MEM_DB:
          this.memPlot.delete(offset);
          break;
        case Farm.MODE_DISK_DB:
          await this.diskPlot.del(num2Bin(offset));
          break;
      }
      this.memTree.removeNode(pieceId);
      await this.removePieceData(pieceId);
    }
  }

  /**
   * Initializes a new plot from seed data (typically at genesis).
   */
  public async seedPlot(pieceSet: IPiece[]): Promise<void> {
    for (const piece of pieceSet) {
      await this.addPiece(piece.piece, piece.data);
    }
  }

  /**
   * Add piece metadata to storage.
   */
  private async addPieceData(pieceData: IPieceData): Promise<void> {
    const binaryPieceData = Buffer.concat([
      num2Bin(pieceData.pieceIndex),
      pieceData.stateHash,
      pieceData.proof,
    ]);
    await this.storage.put(pieceData.pieceHash, binaryPieceData);
  }

  /**
   * Retrieve piece metadata from storage.
   */
  private async getPieceData(pieceHash: Uint8Array): Promise<IPieceData> {
    const binaryPieceData = await this.storage.get(pieceHash);
    if (!binaryPieceData) {
      throw new Error('Cannot get piece data, does not exist in persistent storage');
    }
    return {
      pieceHash,
      pieceIndex: bin2Num(binaryPieceData.subarray(0, 4)),
      stateHash: Uint8Array.from(binaryPieceData.subarray(4, 36)),
      proof: binaryPieceData.subarray(36),
    };
  }

  /**
   * Delete piece metadata from storage
   */
  private async removePieceData(pieceHash: Uint8Array): Promise<void> {
    await this.storage.del(pieceHash);
  }
}
