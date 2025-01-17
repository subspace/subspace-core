// ToDo
// port to Rust/WASM?
// write tests

// tslint:disable: object-literal-sort-keys

import * as fs from 'fs';
import * as path from 'path';
import {random_int} from "random-bytes-numbers";
import {inspect} from 'util';
import * as winston from 'winston';

export function compareUint8Array(aKey: Uint8Array, bKey: Uint8Array): -1 | 0 | 1 {
  const length = aKey.length;
  for (let i = 0; i < length; ++i) {
    const diff = aKey[i] - bKey[i];
    if (diff < 0) {
      return -1;
    } else if (diff > 0) {
      return 1;
    }
  }
  return 0;
}

/**
 * Returns the exclusive-or (XOR) of two byte arrays.
 */
export function xorUint8Array(a: Uint8Array, b: Uint8Array): Uint8Array {
  return a.map((byte, index) => {
    // tslint:disable-next-line:no-bitwise
    return byte ^ b[index];
  });
}

export function areArraysEqual(array1: Uint8Array, array2: Uint8Array): boolean {
  const length = array1.length;
  for (let i = 0; i < length; ++i) {
    if (array1[i] !== array2[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Returns the hamming distance (number of continuous similar bits) between two byte arrays of equal length.
 */
export function measureProximity(a: Uint8Array, b: Uint8Array, reverse = false): number {

  if (a.length !== b.length) {
    throw new Error('Cannot measure proximity between byte arrays of unequal length');
  }

  let proximity = 0;
  let bitString = '';
  xorUint8Array(a, b).forEach((byte) => bitString += byte.toString(2).padStart(8, '0'));

  if (reverse) {
    bitString.split('').reverse().join('');
  }

  for (const bit of bitString) {
    if (bit === '0') {
      ++proximity;
    } else {
      break;
    }
  }

  return proximity;
}

/**
 * Generates exponentially distributed numbers that can be used for intervals between arrivals in Poisson process
 */
export function sample(mean: number): number {
  return -Math.log(Math.random()) * mean;
}

/**
 * Pauses execution synchronously for a random time, exponentially distributed around a mean wait time.
 */
export function randomWait(meanWaitTime: number): Promise<void> {
  return new Promise((resolve) => setTimeout(() => resolve(), sample(meanWaitTime)));
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
 * Converts a positive integer in range 2^32 to binary format (4 bytes).
 */
export function num2Bin(num: number): Uint8Array {
  const arr = new ArrayBuffer(4); // an Int32 takes 4 bytes
  const view = new DataView(arr);
  view.setUint32(0, num, false); // byteOffset = 0; littleEndian = false
  return new Uint8Array(arr);
}

/**
 * Converts a positive integer in range 2^16 to binary format (2 bytes).
 */
export function smallNum2Bin(num: number): Uint8Array {
  const arr = new ArrayBuffer(2); // an Int16 takes 2 bytes
  const view = new DataView(arr);
  view.setUint16(0, num, false); // byteOffset = 0; littleEndian = false
  return new Uint8Array(arr);
}

/**
 * Converts a binary number (4 bytes) to positive integer in range 2^32.
 */
export function bin2Num(bin: Uint8Array): number {
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  return view.getUint32(0, false); // byteOffset = 0; littleEndian = false
}

/**
 * Converts a small binary number (2 bytes) to positive integer in range 2^16.
 */
export function smallBin2Num(bin: Uint8Array): number {
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  return view.getUint16(0, false); // byteOffset = 0; littleEndian = false
}

/**
 * Converts binary data to a hexadecimal string representation.
 */
export function bin2Hex(bin: Uint8Array): string {
  return Buffer.from(bin).toString('hex');
}

/**
 * Converts a hexadecimal string to binary representation.
 */
export function hex2Bin(hex: string): Uint8Array {
  return Uint8Array.from(Buffer.from(hex, 'hex'));
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
export function bin2JSON(data: Uint8Array): any {
  return JSON.parse(Buffer.from(data).toString());
}

/**
 * Converts a string to binary data.
 */
export function str2Bin(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data));
}

/**
 * Prints all properties of nested object to the console.
 */
export function print(data: object): void {
  // tslint:disable-next-line: no-console
  console.log(inspect(data, false, null, true));
}

export function rmDirRecursiveSync(dirPath: string): void {
  dirPath = path.normalize(dirPath);
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach((file) => {
      const curPath = path.join(dirPath, file);
      if (fs.lstatSync(curPath).isDirectory()) {
        rmDirRecursiveSync(curPath);
      } else {
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(dirPath);
  }
}

export function allocatePort(): number {
  return 20000 + Math.round(Math.random() * 30000);
}

export interface ILogger {
  error: winston.LeveledLogMethod;
  warn: winston.LeveledLogMethod;
  info: winston.LeveledLogMethod;
  debug: winston.LeveledLogMethod;
  verbose: winston.LeveledLogMethod;

  /**
   * Create child logger with additional metadata
   *
   * @param metadata
   */
  child(metadata: {}): ILogger;
}

export function createLogger(logLevel: 'error' | 'warn' | 'info' | 'debug' | 'verbose', metadata?: {}): ILogger {
  return winston.createLogger({
    defaultMeta: metadata,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.metadata({
        fillExcept: ['message', 'level', 'timestamp'],
      }),
      winston.format.cli(),
      winston.format.simple(),
    ),
    level: logLevel,
    transports: [
      new winston.transports.Console(),
    ],
  });
}

export function randomElement<E>(elements: E[]): E {
  if (elements.length === 1) {
    return elements[0];
  }

  return elements[random_int(0, elements.length - 1)];
}

/**
 * In-place array shuffle (random sort) using Fisher-Yates (aka Knuth) Shuffle algorithm
 * https://stackoverflow.com/a/2450976
 *
 * @param array
 *
 * @return The same array
 */
export function shuffleArray<A>(array: A[]): A[] {
  let currentIndex = array.length;

  // While there remain elements to shuffle...
  while (0 !== currentIndex) {

    // Pick a remaining element...
    const randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex -= 1;

    // And swap it with the current element.
    const temporaryValue = array[currentIndex];
    array[currentIndex] = array[randomIndex];
    array[randomIndex] = temporaryValue;
  }

  return array;
}
