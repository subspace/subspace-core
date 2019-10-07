import * as fs from "fs";
import {PIECE_SIZE} from "../main/constants";
import {allocateEmptyFile, isAllZeroes} from "./utils";

export class MegaPlot {
  /**
   * @param plotDataLocation
   * @param singlePlotSize
   * @param numberOfPlots
   * @param readCacheSize
   */
  public static async create(plotDataLocation: string, singlePlotSize: number, numberOfPlots: number, readCacheSize: number = 5): Promise<MegaPlot> {
    if (singlePlotSize % PIECE_SIZE === 0) {
      throw new Error('Incorrect plot size, should be multiple of piece size and plot size');
    }
    await allocateEmptyFile(plotDataLocation, singlePlotSize * numberOfPlots, PIECE_SIZE);
    const plotData = await fs.promises.open(plotDataLocation, 'r+');
    return new MegaPlot(plotData, numberOfPlots, readCacheSize);
  }

  /**
   * Mapping from offset to the values for all plots as single binary blob
   */
  private readonly readCache = new Map<number, Uint8Array | null>();
  /**
   * Mapping from offset to (mapping from plot index to encoding)
   */
  private readonly writeCache = new Map<number, Map<number, Uint8Array>>();
  /**
   * Mapping from offset to set of plot indexes that deleted a piece
   */
  private readonly deleteCache = new Map<number, Set<number>>();
  private readonly megaPieceSize: number;
  /**
   * Mapping from offset to set of plot indexes that closed store
   */
  private closedSet = new Set<number>();

  public constructor(
    private readonly plotData: fs.promises.FileHandle,
    private readonly numberOfPlots: number,
    private readonly readCacheSize: number = 5,
  ) {
    this.megaPieceSize = PIECE_SIZE * numberOfPlots;
  }

  public async add(value: Uint8Array, offset: number, plotIndex: number): Promise<void> {
    const writeCache = this.writeCache;
    const writeCacheForOffset = writeCache.get(offset) || new Map<number, Uint8Array>();
    writeCacheForOffset.set(plotIndex, value);
    switch (writeCacheForOffset.size) {
      case 1:
        writeCache.set(offset, writeCacheForOffset);
        break;
      case this.numberOfPlots:
        const megaPieceParts: Uint8Array[] = [];
        for (const megaPieceData of writeCacheForOffset.entries()) {
          const [plotIndex, value] = megaPieceData;
          megaPieceParts[plotIndex] = value;
        }
        writeCache.delete(offset);
        const megaPieceSize = this.megaPieceSize;
        const megaPiece = Buffer.concat(megaPieceParts);
        await this.plotData.write(megaPiece, 0, megaPieceSize, offset * megaPieceSize);
        break;
    }
  }

  public async get(offset: number, plotIndex: number): Promise<Uint8Array | null> {
    const cachedValue = this.readCache.get(offset);
    if (cachedValue !== undefined) {
      if (cachedValue === null) {
        return null;
      }

      return cachedValue.subarray(
        PIECE_SIZE * plotIndex,
        PIECE_SIZE * (plotIndex + 1),
      );
    }

    const megaPieceSize = this.megaPieceSize;
    const data = Buffer.allocUnsafe(megaPieceSize);
    await this.plotData.read(data, 0, megaPieceSize, offset * megaPieceSize);
    if (isAllZeroes(data)) {
      // Not found, all zeroes
      this.readCache.set(offset, null);
      if (this.readCache.size > this.readCacheSize) {
        this.readCache.delete(this.readCache.keys().next().value);
      }
      return null;
    }

    this.readCache.set(offset, data);
    if (this.readCache.size > this.readCacheSize) {
      this.readCache.delete(this.readCache.keys().next().value);
    }

    return data.subarray(
      PIECE_SIZE * plotIndex,
      PIECE_SIZE * (plotIndex + 1),
    );
  }

  public async del(offset: number, plotIndex: number): Promise<void> {
    const deleteCache = this.deleteCache;
    const deleteCacheForOffset = deleteCache.get(offset) || new Set<number>();
    deleteCacheForOffset.add(plotIndex);
    switch (deleteCacheForOffset.size) {
      case 1:
        deleteCache.set(offset, deleteCacheForOffset);
        break;
      case this.numberOfPlots:
        deleteCache.delete(offset);
        const megaPieceSize = this.megaPieceSize;
        await this.plotData.write(new Uint8Array(megaPieceSize), 0, megaPieceSize, offset * megaPieceSize);
        break;
    }
  }

  public async close(plotIndex: number): Promise<void> {
    this.closedSet.add(plotIndex);
    if (this.closedSet.size === this.numberOfPlots) {
      // Close with last closed plot
      await this.plotData.close();
    }
  }
}
