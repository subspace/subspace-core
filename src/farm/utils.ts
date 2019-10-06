import * as fs from "fs";

export async function allocateEmptyFile(path: string, size: number, chunkSize: number): Promise<void> {
  const fileHandle = await fs.promises.open(path, 'w');
  let written = 0;
  const emptyPiece = Buffer.alloc(chunkSize);
  while (written < size) {
    await fileHandle.write(emptyPiece);
    written += chunkSize;
  }
  await fileHandle.close();
}

export function isAllZeroes(array: Uint8Array): boolean {
  for (let byte = 0, length = array.length; byte < length; ++byte) {
    if (array[byte] !== 0) {
      return false;
    }
  }
  return true;
}
