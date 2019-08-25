import {PIECE_SIZE} from "../main/constants";
import {IStorageInstance} from "./IStorage";

export class MemoryStorage implements IStorageInstance {
  public static async create(plotSize: number): Promise<MemoryStorage> {
    const numberOfPieces = plotSize / PIECE_SIZE;
    return new MemoryStorage(plotSize, numberOfPieces);
  }

  public static async open(): Promise<MemoryStorage> {
    throw new Error('Not implemented!');
  }

  public readonly numberOfPieces: number;
  public readonly plotSize: number;

  private readonly plotData = new Map<number, Uint8Array>();
  private readonly plotMetadata = new Map<number, Uint8Array>();

  private constructor(
    plotSize: number,
    numberOfPieces: number,
  ) {
    this.numberOfPieces = numberOfPieces;
    this.plotSize = plotSize;
  }

  public async readData(offset: number): Promise<Uint8Array> {
    const data = this.plotData.get(offset);
    if (!data) {
      throw new Error('No data at this offset');
    }

    return data;
  }

  public async writeData(offset: number, data: Uint8Array): Promise<void> {
    this.plotData.set(offset, data);
  }

  public async readMetadata(offset: number): Promise<Uint8Array> {
    const data = this.plotMetadata.get(offset);
    if (!data) {
      throw new Error('No data at this offset');
    }

    return data;
  }

  public async writeMetadata(offset: number, data: Uint8Array): Promise<void> {
    this.plotMetadata.set(offset, data);
  }

  public async close(): Promise<void> {
      // Nothing to do here
  }
}
