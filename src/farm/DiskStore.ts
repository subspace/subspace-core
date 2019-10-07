import * as fs from "fs";
import {PIECE_SIZE} from "../main/constants";
import IStore from "./IStore";
import {allocateEmptyFile, isAllZeroes} from "./utils";

export default class DiskStore implements IStore {
  /**
   * @param plotDataLocation
   * @param size
   */
  public static async create(plotDataLocation: string, size: number): Promise<DiskStore> {
    if (size % PIECE_SIZE === 0) {
      throw new Error('Incorrect plot size, should be multiple of piece size');
    }
    await allocateEmptyFile(plotDataLocation, size, PIECE_SIZE);
    const plotData = await fs.promises.open(plotDataLocation, 'r+');
    return new DiskStore(plotData);
  }

  public constructor(private readonly plotData: fs.promises.FileHandle) {
  }

  public async add(value: Uint8Array, offset: number): Promise<void> {
    await this.plotData.write(value, 0, PIECE_SIZE, offset * PIECE_SIZE);
  }

  public async get(offset: number): Promise<Uint8Array | null> {
    const data = Buffer.allocUnsafe(PIECE_SIZE);
    await this.plotData.read(data, 0, PIECE_SIZE, offset * PIECE_SIZE);
    if (isAllZeroes(data)) {
      // Not found, all zeroes
      return null;
    }
    return data;
  }

  public async del(offset: number): Promise<void> {
    await this.plotData.write(new Uint8Array(PIECE_SIZE), 0, PIECE_SIZE, offset * PIECE_SIZE);
  }

  public async close(): Promise<void> {
    await this.plotData.close();
  }
}
