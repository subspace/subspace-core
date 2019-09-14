// tslint:disable: object-literal-sort-keys

import { NodeManagerJsUint8Array, Tree } from "@subspace/red-black-tree";
import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { PIECE_SIZE } from "../main/constants";
import { IEncodingSet, IPiece, IPieceData } from '../main/interfaces';
import { Storage } from '../storage/storage';
import { areArraysEqual, smallBin2Num, smallNum2Bin } from "../utils/utils";
import { Plot } from './plot';

// ToDo
  // load saved disk plots after shutdown
  // support disk based tree for larger plots
  // direct disk plotting with encodings for same piece and metadata directly aligned
  // redis backed memory farming
  // resize plots as the piece set grows by replacing pieces and deleting empty plots

/**
 * Manages all plots for this node. Plots store encoded pieces which are used to solve the block challenge.
 *
 * Encoded pieces are stored in plots under two possible modes
 *    Memory Based (JS Map)
 *    Disk Based (Rocks DB)
 *
 * Indexes are maintained in a RB Tree in memory
 *
 * Piece metadata (for proofs) is kept in a store to match plotting mode
 *    Memory Based (JS Map)
 *    Disk Based (Rocks DB)
 *
 * Supports farming in parallel across multiple plots with different addresses
 */
export class Farm {
  public static readonly MODE_MEM_DB = 'mem-db';
  public static readonly MODE_DISK_DB = 'disk-db';
  public static readonly MODE_INDEXED_DB = 'indexed-db';

  public readonly plots: Plot[];
  private readonly mode: typeof Farm.MODE_MEM_DB | typeof Farm.MODE_DISK_DB | typeof Farm.MODE_INDEXED_DB;
  private readonly encodingRounds: number;
  private readonly metadataStore: Storage;
  private readonly pieceIndex: Tree<Uint8Array, number>;
  private pieceOffset: number;

  /**
   * Returns a new farm instance for use by parent node.
   *
   * @param mode the type of plotting and storage backend to be used (e.g. memory or disk)
   * @param numberOfPlots how many plots to encode each new piece under (when the ledger is smaller than average disk)
   * @param farmSize the maximum allowable size of all disk plots combined
   * @param encodingRounds the number of rounds of encoding/decoding to apply to each piece
   * @param addresses the addresses that will be used for plotting (same as number of plots)
   */
  constructor(
    mode: typeof Farm.MODE_MEM_DB | typeof Farm.MODE_DISK_DB | typeof Farm.MODE_INDEXED_DB,
    metadataStore: Storage,
    storageDir: string,
    numberOfPlots: number,
    farmSize: number,
    encodingRounds: number,
    addresses: Uint8Array[],
  ) {
    this.mode = mode;
    this.metadataStore = metadataStore;
    this.encodingRounds = encodingRounds;
    this.pieceOffset = 0;
    this.plots = [];

    let plotAdapter: string;
    // let indexAdapter: string;

    switch (this.mode) {
      case Farm.MODE_MEM_DB:
        plotAdapter = 'mem-db';
        // indexAdapter = 'memory';
        break;
      case Farm.MODE_DISK_DB:
        plotAdapter = 'disk-db';
        // indexAdapter = 'disk';
        break;
      case Farm.MODE_INDEXED_DB:
        plotAdapter = 'indexed-db';
        // indexAdapter = 'disk';
        break;
      default:
        plotAdapter = 'mem-db';
        // indexAdapter = 'memory';
        break;
    }

    // this.metadataStore = new Storage(storageAdapter, storageDir, `farm-${mode}`);
    const plotSize = Math.floor(farmSize / numberOfPlots);

    for (let i = 0; i < numberOfPlots; ++i) {
      const plot = Plot.open(plotAdapter, storageDir, i, plotSize, addresses[i]);
      this.plots.push(plot);
    }

    const nodeManager = new NodeManagerJsUint8Array<number>();
    this.pieceIndex = new Tree(nodeManager);

  }

  /**
   * Returns the size of the farm in bytes.
   */
  public getSize(): number {
    return this.plots.length * this.pieceOffset * PIECE_SIZE;
  }

  /**
   * Returns the number of pieces stored under all plots.
   */
  public getPieceCount(): number {
    return this.plots.length * this.pieceOffset;
  }

  /**
   * Returns the address (BLS public key hash) used by this plot for encoding
   */
  public getPlotAddress(index: number): Uint8Array {
    return this.plots[index].address;
  }

  /**
   * Adds a new encoded piece to plot, index, and metadata store.
   */
  public async addPiece(piece: Uint8Array, pieceData: IPieceData): Promise<void> {

    this.pieceOffset ++;
    const offset = this.pieceOffset;

    // tslint:disable-next-line: prefer-for-of
    for (let i = 0; i < this.plots.length; ++i) {
      const encodedPiece = codes.encodePiece(piece, this.plots[i].address, this.encodingRounds);
      await this.plots[i].addEncoding(encodedPiece, offset);
      // tslint:disable-next-line: max-line-length no-console
      // console.log(`[+] Finished plotting encoding ${bin2Hex(crypto.hash(encodedPiece)).substring(0, 16)} from piece ${bin2Hex(pieceData.pieceHash).substring(0, 16)} at offset ${offset} for plot ${i}.`);
    }

    await this.addPieceData(pieceData);
    this.pieceIndex.addNode(pieceData.pieceHash, offset);
    // tslint:disable-next-line: no-console
    // console.log(`Completed plotting pieces for offset ${offset}`);

  }

  /**
   * Searches index for closest piece id to target by XOR, fetches the encoding from the first available plot and returns the decoded piece with metadata.
   */
  public async getClosestPiece(target: Uint8Array): Promise<IPiece | void> {
    const node = this.pieceIndex.getClosestNode(target);
    if (node) {
      const [pieceHash, offset] = node;
      const plot = this.plots[0];
      const encoding = await plot.getEncoding(offset);
      if (encoding) {
        const piece = codes.decodePiece(encoding, plot.address, this.encodingRounds);
        const data = await this.getPieceData(pieceHash);
        return { piece, data };
      }
    }
  }

  /**
   * Searches the index for exact match based on piece id, fetches the encoding from the first available plot and returns the decoded piece with metadata.
   */
  public async getExactPiece(pieceId: Uint8Array): Promise<IPiece | void> {
    const offset = this.pieceIndex.getNodeValue(pieceId);
    if (offset) {
      const plot = this.plots[0];
      const encoding = await plot.getEncoding(offset);
      if (encoding) {
        const piece = codes.decodePiece(encoding, plot.address, this.encodingRounds);
        const pieceHash = crypto.hash(piece);
        if (areArraysEqual(pieceHash, pieceId)) {
          const data = await this.getPieceData(pieceId);
          return { piece, data };
        }
      }
    }
  }

  /**
   * Searches index for closest piece id to target by XOR and returns all associated encodings with single piece metadata.
   */
  public async getClosestEncodings(target: Uint8Array): Promise<IEncodingSet | void> {
    const node = this.pieceIndex.getClosestNode(target);
    if (node) {
      const [pieceHash, offset] = node;
      const encodings: Uint8Array[] = [];
      for (const plot of this.plots) {
        // tslint:disable-next-line: no-console
        // console.log(`Getting encoding for plot ${plot.index} at offset ${offset}`);
        const encoding = await plot.getEncoding(offset);
        encodings.push(encoding);
      }
      if (encodings.length) {
        const data = await this.getPieceData(pieceHash);
        return { encodings, data };
      }
    }
  }

  /**
   * Searches the index for the exact match based on piece id and returns the associated encoding with metadata.
   */
  public async getExactEncodings(pieceId: Uint8Array): Promise<IEncodingSet | void> {
    const offset = this.pieceIndex.getNodeValue(pieceId);
    if (offset) {
      const encodings: Uint8Array[] = [];
      for (const plot of this.plots) {
        const encoding = await plot.getEncoding(offset);
        encodings.push(encoding);
      }
      if (encodings.length) {
        const data = await this.getPieceData(pieceId);
        return { encodings, data };
      }
    }
  }

  /**
   * Deletes each encoding for a piece from each plot, deletes piece from index, and data from metadata store.
   */
  public async removePieceAndEncodings(pieceId: Uint8Array): Promise<void> {
    const offset = this.pieceIndex.getNodeValue(pieceId);
    if (offset) {
      for (const plot of this.plots) {
        await plot.deleteEncoding(offset);
      }
      this.pieceIndex.removeNode(pieceId);
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
      pieceData.stateHash,
      smallNum2Bin(pieceData.pieceIndex),
      pieceData.proof,
    ]);
    await this.metadataStore.put(pieceData.pieceHash, binaryPieceData);
  }

  /**
   * Retrieve piece metadata from storage.
   */
  private async getPieceData(pieceHash: Uint8Array): Promise<IPieceData> {
    const binaryPieceData = await this.metadataStore.get(pieceHash);
    if (!binaryPieceData) {
      throw new Error('Cannot get piece data, does not exist in persistent storage');
    }
    return {
      pieceHash,
      stateHash: Uint8Array.from(binaryPieceData.subarray(0, 32)),
      pieceIndex: smallBin2Num(binaryPieceData.subarray(32, 34)),
      proof: binaryPieceData.subarray(34),
    };
  }

  /**
   * Delete piece metadata from storage
   */
  private async removePieceData(pieceHash: Uint8Array): Promise<void> {
    await this.metadataStore.del(pieceHash);
  }
}
