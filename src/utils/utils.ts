// ToDo
  // port to Rust/WASM?
  // write tests

/**
 * Returns the exclusive-or (XOR) of two byte arrays.
 */
export function xorUint8Array(a: Uint8Array, b: Uint8Array): Uint8Array {
  return a.map((byte, index) => {
      // tslint:disable-next-line:no-bitwise
      return byte ^ b[index];
  });
}

/**
 * Pauses execution synchronously for the specified time period.
 */
export function wait(delay: number): void {
  const startTime = Date.now();
  let now = startTime;
  while ((now - startTime) < delay) {
    now = Date.now();
  }
}

/**
 * Returns the deep clone of an object.
 */
export function clone(data: object): any {
  return JSON.parse(JSON.stringify(data));
}

/**
 * Converts a unix timestamp to a human readable date.
 */
export function num2Date(num: number): string {
  return (new Date(num)).toString();
}

/**
 * Converts an integer to binary format.
 */
export function num2Bin(num: number): Uint8Array {
  return Buffer.from(num.toString(2));
}

/**
 * Converts a binary number to number.
 */
export function bin2Num(bin: Uint8Array): number {
  return Number.parseInt(bin.toString(), 2);
}

/**
 * Converts binary data to a hexadecimal string representation.
 */
export function bin2Hex(bin: Uint8Array): string {
  return Buffer.from(bin).toString('hex');
}

/**
 * Converts a JSON object to binary data.
 */
export function JSON2Bin(data: object): Uint8Array {
  return new Uint8Array(Buffer.from(JSON.stringify(data)));
}

/**
 * Converts binary data back to a JSON object.
 */
export function bin2JSON(data: Uint8Array): object {
  return JSON.parse(Buffer.from(data).toString());
}
