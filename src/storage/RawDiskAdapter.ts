import * as fs from "fs";
import {PIECE_SIZE} from "../main/constants";
import {bin2Num, num2Bin} from "../utils/utils";
import IAdapter from './IAdapter';

async function allocateEmptyFile(path: string, size: number, chunkSize: number): Promise<void> {
  const fileHandle = await fs.promises.open(path, 'w');
  let written = 0;
  const emptyPiece = Buffer.alloc(chunkSize);
  while (written < size) {
    await fileHandle.write(emptyPiece);
    written += chunkSize;
  }
  await fileHandle.close();
}

function isAllZeroes(array: Uint8Array): boolean {
  for (let byte = 0, length = array.length; byte < length; ++byte) {
    if (array[byte] !== 0) {
      return false;
    }
  }
  return true;
}

// This implementation is a rough inefficient sketch that follows existing API defined by IAdapter
export default class RawDiskAdapter implements IAdapter {
  public static async create(plotDataLocation: string, plotSize: number): Promise<RawDiskAdapter> {
    await allocateEmptyFile(plotDataLocation, plotSize, PIECE_SIZE);
    const plotData = await fs.promises.open(plotDataLocation, 'r+');
    return new RawDiskAdapter(plotData, plotSize);
  }

  public constructor(
    private readonly plotData: fs.promises.FileHandle,
    private readonly plotSize: number,
  ) {
  }

  public async put(key: Uint8Array, value: Uint8Array): Promise<void> {
    await this.plotData.write(value, 0, PIECE_SIZE, bin2Num(key) * PIECE_SIZE);
  }

  public async get(key: Uint8Array): Promise<Uint8Array | null> {
    const data = Buffer.allocUnsafe(length);
    await this.plotData.read(data, 0, length, bin2Num(key) * PIECE_SIZE);
    if (isAllZeroes(data)) {
      // Not found, all zeroes
      return null;
    }
    return data;
  }

  public async del(key: Uint8Array): Promise<void> {
    await this.plotData.write(new Uint8Array(PIECE_SIZE), 0, PIECE_SIZE, bin2Num(key) * PIECE_SIZE);
  }

  public async getKeys(): Promise<Uint8Array[]> {
    const keys: Uint8Array[] = [];
    for (let i = 0, max = this.plotSize / PIECE_SIZE; i < max; ++i) {
      const key = num2Bin(i);
      const data = await this.get(key);
      if (!data) {
        break;
      }
      keys.push(key);
    }
    return keys;
  }

  public async getLength(): Promise<number> {
    const keys = await this.getKeys();
    return keys.length;
  }

  public async clear(): Promise<void> {
    const keys = await this.getKeys();
    for (const key of keys) {
      await this.del(key);
    }
  }

  public async close(): Promise<void> {
    await this.plotData.close();
  }
}
