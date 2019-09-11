// ToDo
  // port to Rust/WASM?
  // write tests

// tslint:disable: object-literal-sort-keys

import * as fs from 'fs';
import * as path from 'path';
import { inspect } from 'util';
import { IPeerContactInfo } from '../main/interfaces';
import { IAddress, INodeAddress } from '../network/Network';

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
 * Pauses execution synchronously for the specified time period.
 */
export async function wait(delay: number): Promise<void> {
  const startTime = Date.now();
  let now = startTime;
  while ((now - startTime) < delay) {
    now = Date.now();
    return;
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

let portOffset = 20000;
export function allocatePort(): number {
  ++portOffset;
  return portOffset;
}

export function parseContactInfo(selfContactInfo: IPeerContactInfo, bootstrapPeerContactInfo: IPeerContactInfo[]): [
  INodeAddress[],
  INodeAddress[],
  INodeAddress[],
  Uint8Array,
  IAddress,
  IAddress,
  IAddress,
 ] {
  const bootstrapUdPNodes: INodeAddress [] = [];
  const bootstrapTcpNodes: INodeAddress [] = [];
  const bootstrapWsNodes: INodeAddress [] = [];

  for (const peer of bootstrapPeerContactInfo) {
    bootstrapUdPNodes.push({
      nodeId: peer.nodeId,
      address: peer.address,
      port: peer.udpPort,
      protocolVersion: peer.protocolVersion,
    });

    bootstrapTcpNodes.push({
      nodeId: peer.nodeId,
      address: peer.address,
      port: peer.tcpPort,
      protocolVersion: peer.protocolVersion,
    });

    bootstrapWsNodes.push({
      nodeId: peer.nodeId,
      address: peer.address,
      port: peer.wsPort,
      protocolVersion: peer.protocolVersion,
    });
  }

  const ownNodeId = selfContactInfo.nodeId;
  const ownUdpAddress: IAddress = {
    address: selfContactInfo.address,
    port: selfContactInfo.udpPort,
    protocolVersion: selfContactInfo.protocolVersion,
  };

  const ownTcpAddress: IAddress = {
    address: selfContactInfo.address,
    port: selfContactInfo.tcpPort,
    protocolVersion: selfContactInfo.protocolVersion,
  };

  const ownWsAddress: IAddress = {
    address: selfContactInfo.address,
    port: selfContactInfo.wsPort,
    protocolVersion: selfContactInfo.protocolVersion,
  };

  return [
    bootstrapUdPNodes,
    bootstrapTcpNodes,
    bootstrapWsNodes,
    ownNodeId,
    ownUdpAddress,
    ownTcpAddress,
    ownWsAddress,
  ];
}
