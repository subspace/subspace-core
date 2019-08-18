// tslint:disable: max-classes-per-file
// tslint:disable: no-console

import { NodeManagerJsUint8Array, Tree } from "@subspace/red-black-tree";
import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { IPlotData } from '../main/interfaces';
import { Storage } from '../storage/storage';

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
    const storage = new Storage(adapter, 'farm');
    const farm = new Farm(storage, mode, adapter);
    return farm;
  }

  private readonly mode: typeof Farm.MODE_MEM_DB | typeof Farm.MODE_DISK_DB;
  private storage: Storage;
  private memTree: Tree<Uint8Array, number>;
  private memPlot: Map<number, Uint8Array> = new Map();
  private diskPlot: Storage;
  private pieceOffset = 0;
  private nodeId: Uint8Array;

  constructor(storage: Storage, mode: typeof Farm.MODE_MEM_DB | typeof Farm.MODE_DISK_DB, adapter: string) {
    this.mode = mode;
    this.storage = storage;
    this.nodeId = new Uint8Array();
    const nodeManager = new NodeManagerJsUint8Array<number>();
    this.memTree = new Tree(nodeManager);
    this.diskPlot = new Storage(adapter, 'plot');
  }

  /**
   * Initializes a new plot from seed data (typically at genesis).
   */
  public initPlot(nodeId: Uint8Array, pieceSet: Uint8Array[]): void {
    this.nodeId = nodeId;
    for (const piece of pieceSet) {
      this.addPiece(piece);
    }
  }

  /**
   * Adds a new encoded piece to plot and index.
   */
  public async addPiece(piece: Uint8Array): Promise<void> {
    const pieceId = crypto.hash(piece);
    const encodedPiece = codes.encodePiece(piece, this.nodeId, 16);
    this.pieceOffset ++;

    switch (this.mode) {
      case Farm.MODE_MEM_DB:
        this.memPlot.set(this.pieceOffset, encodedPiece);
      case Farm.MODE_DISK_DB:
        await this.storage.put(Buffer.from(this.pieceOffset.toString(2)), encodedPiece);
    }

    this.memTree.addNode(pieceId, this.pieceOffset);
  }

  /**
   * Searches index for closest piece id to target by XOR and returns the decoded piece.
   */
  public async getClosestPiece(target: Uint8Array): Promise<Uint8Array | void> {
    const node = this.memTree.getClosestNode(target);
    console.log(node);
    if (node) {
      let encoding: Uint8Array | null | undefined;
      switch (this.mode) {
        case Farm.MODE_MEM_DB:
          encoding = this.memPlot.get(node[1]);
        case Farm.MODE_DISK_DB:
          encoding = await this.diskPlot.get(Buffer.from(node[1].toString(2)));
      }
      if (encoding) {
        const piece = codes.decodePiece(encoding, this.nodeId);
        return piece;
      }
    }
  }

  /**
   * Searches the index for exact match based on piece id and returns the decoded piece.
   */
  public async getExactPiece(pieceId: Uint8Array): Promise<Uint8Array | void> {
    const offset = this.memTree.getNodeValue(pieceId);
    if (offset) {
      let encoding: Uint8Array | null | undefined;
      switch (this.mode) {
        case Farm.MODE_MEM_DB:
          encoding = this.memPlot.get(offset);
        case Farm.MODE_DISK_DB:
          encoding = await this.diskPlot.get(Buffer.from(offset.toString(2)));
      }
      if (encoding) {
        const piece = codes.decodePiece(encoding, this.nodeId);
        if (crypto.hash(piece).toString() === pieceId.toString()) {
          return piece;
        }
      }
    }
  }

  /**
   * Searches index for closest piece id to target by XOR and returns the associated encoding.
   */
  public async getClosestEncoding(target: Uint8Array): Promise<Uint8Array | void> {
    const node = this.memTree.getClosestNode(target);
    if (node) {
      let encoding: Uint8Array | null | undefined;
      switch (this.mode) {
        case Farm.MODE_MEM_DB:
          encoding = this.memPlot.get(node[1]);
        case Farm.MODE_DISK_DB:
          encoding = await this.diskPlot.get(Buffer.from(node[1].toString(2)));
      }
      if (encoding) {
        return encoding;
      }
    }
  }

  /**
   * Searches the index for the exact match boased on piece id and returns the associated encoding.
   */
  public async getExactEncoding(pieceId: Uint8Array): Promise<Uint8Array | void> {
    const offset = this.memTree.getNodeValue(pieceId);
    if (offset) {
      let encoding: Uint8Array | null | undefined;
      switch (this.mode) {
        case Farm.MODE_MEM_DB:
          encoding = this.memPlot.get(offset);
        case Farm.MODE_DISK_DB:
          encoding = await this.diskPlot.get(Buffer.from(offset.toString(2)));
      }
      if (encoding) {
        return encoding;
      }
    }
  }

  /**
   * Deletes an encoded piece from the plot and index.
   */
  public async removePiece(pieceId: Uint8Array): Promise<void> {
    const offset = this.memTree.getNodeValue(pieceId);
    if (offset) {
      switch (this.mode) {
        case Farm.MODE_MEM_DB:
          this.memPlot.delete(offset);
        case Farm.MODE_DISK_DB:
          await this.storage.del(Buffer.from(offset.toString(2)));
      }
      this.memTree.removeNode(pieceId);
    }
  }
}
