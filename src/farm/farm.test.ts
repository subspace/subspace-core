if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}
// tslint:disable: object-literal-sort-keys

import * as fs from 'fs';
import * as os from 'os';
import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { HASH_LENGTH } from '../main/constants';
import { IPiece } from '../main/interfaces';
import { Storage } from '../storage/storage';
import { rmDirRecursiveSync } from '../utils/utils';
import { Farm } from './Farm';
import {Plot} from "./Plot";

const storageDir = `${os.tmpdir()}/subspace/tests/farm`;

if (fs.existsSync(storageDir)) {
  rmDirRecursiveSync(storageDir);
 }

fs.mkdirSync(storageDir, { recursive: true });

test('mem-plot', async () => {
  const plotMode = Plot.ADAPTER_MEM_DB;
  const farmSize = 409600;
  const paddedDataSize = 120191;
  const numberOfPlots = 32;
  const encodingRounds = 3;
  const addresses: Uint8Array[] = [];
  for (let i = 0; i < numberOfPlots; ++i) {
    addresses.push(crypto.randomBytes(HASH_LENGTH));
  }
  const metadataStore = new Storage('memory', storageDir, 'farm');
  const farm = await Farm.open(plotMode, metadataStore, storageDir, numberOfPlots, farmSize, encodingRounds, addresses);
  const data = crypto.randomBytes(paddedDataSize);
  const paddedData = codes.padLevel(data);
  const encodedData = await codes.erasureCodeLevel(paddedData);
  const pieceSet = codes.sliceLevel(encodedData);
  const pieceHashes = pieceSet.map((piece) => crypto.hash(piece));
  const stateHash = crypto.randomBytes(HASH_LENGTH);
  const { proofs } = crypto.buildMerkleTree(pieceHashes);
  const pieces: IPiece[] = [];
  for (let i = 0; i < pieceSet.length; ++i) {
    pieces[i] = {
      piece: pieceSet[i],
      data: {
        pieceHash: pieceHashes[i],
        stateHash,
        pieceIndex: i,
        proof: proofs[i],
      },
    };
  }

  // bulk add
  await farm.seedPlot(pieces);

  // get closest
  const target = crypto.randomBytes(HASH_LENGTH);
  const closestPiece = await farm.getClosestPiece(target);
  const closestEncodings = await farm.getClosestEncodings(target);
  if (closestPiece && closestEncodings) {
    expect(pieceSet).toContainEqual(closestPiece.piece);
    expect(closestEncodings.encodings.length).toBeGreaterThan(0);
    for (let i = 0; i < closestEncodings.encodings.length; ++i) {
      expect(codes.decodePiece(closestEncodings.encodings[i], addresses[i], encodingRounds).toString()).toBe(closestPiece.piece.toString());
    }
  } else {
    fail(true);
  }

  // get exact
  const pieceId = pieceHashes[0];
  const exactPiece = await farm.getExactPiece(pieceId);
  const exactEncodings = await farm.getExactEncodings(pieceId);
  if (exactPiece && exactEncodings) {
    expect(pieceSet).toContainEqual(exactPiece.piece);
    expect(exactEncodings.encodings.length).toBeGreaterThan(0);
    for (let i = 0; i < exactEncodings.encodings.length; ++i) {
      expect(codes.decodePiece(exactEncodings.encodings[i], addresses[i], encodingRounds).toString()).toBe(exactPiece.piece.toString());
    }
  } else {
    fail(true);
  }

  // test delete
  await farm.removePieceAndEncodings(pieceId);
  const deletedExactPiece = await farm.getExactPiece(pieceId);
  expect(deletedExactPiece).toBeFalsy();
  const deletedExactEncodings = await farm.getExactEncodings(pieceId);
  expect(deletedExactEncodings).toBeFalsy();
});

test('rocks-plot', async () => {
  const plotMode = Plot.ADAPTER_ROCKS_DB;
  const farmSize = 409600;
  const paddedDataSize = 120191;
  const numberOfPlots = 32;
  const encodingRounds = 3;
  const addresses: Uint8Array[] = [];
  for (let i = 0; i < numberOfPlots; ++i) {
    addresses.push(crypto.randomBytes(HASH_LENGTH));
  }
  const metadataStore = new Storage('rocks', storageDir, 'farm');
  const farm = await Farm.open(plotMode, metadataStore, storageDir, numberOfPlots, farmSize, encodingRounds, addresses);
  const data = crypto.randomBytes(paddedDataSize);
  const paddedData = codes.padLevel(data);
  const encodedData = await codes.erasureCodeLevel(paddedData);
  const pieceSet = codes.sliceLevel(encodedData);
  const pieceHashes = pieceSet.map((piece) => crypto.hash(piece));
  const stateHash = crypto.randomBytes(HASH_LENGTH);
  const { proofs } = crypto.buildMerkleTree(pieceHashes);
  const pieces: IPiece[] = [];
  for (let i = 0; i < pieceSet.length; ++i) {
    pieces[i] = {
      piece: pieceSet[i],
      data: {
        pieceHash: pieceHashes[i],
        stateHash,
        pieceIndex: i,
        proof: proofs[i],
      },
    };
  }

  // bulk add
  await farm.seedPlot(pieces);

  // get closest
  const target = crypto.randomBytes(HASH_LENGTH);
  const closestPiece = await farm.getClosestPiece(target);
  const closestEncodings = await farm.getClosestEncodings(target);
  if (closestPiece && closestEncodings) {
    expect(pieceSet).toContainEqual(closestPiece.piece);
    expect(closestEncodings.encodings.length).toBeGreaterThan(0);
    for (let i = 0; i < closestEncodings.encodings.length; ++i) {
      expect(codes.decodePiece(closestEncodings.encodings[i], addresses[i], encodingRounds).toString()).toBe(closestPiece.piece.toString());
    }
  } else {
    fail(true);
  }

  // get exact
  const pieceId = pieceHashes[0];
  const exactPiece = await farm.getExactPiece(pieceId);
  const exactEncodings = await farm.getExactEncodings(pieceId);
  if (exactPiece && exactEncodings) {
    expect(pieceSet).toContainEqual(exactPiece.piece);
    expect(exactEncodings.encodings.length).toBeGreaterThan(0);
    for (let i = 0; i < exactEncodings.encodings.length; ++i) {
      expect(codes.decodePiece(exactEncodings.encodings[i], addresses[i], encodingRounds).toString()).toBe(exactPiece.piece.toString());
    }
  } else {
    fail(true);
  }

  // test delete
  await farm.removePieceAndEncodings(pieceId);
  const deletedExactPiece = await farm.getExactPiece(pieceId);
  expect(deletedExactPiece).toBeFalsy();
  const deletedExactEncodings = await farm.getExactEncodings(pieceId);
  expect(deletedExactEncodings).toBeFalsy();
});

test('disk-plot', async () => {
  const plotMode = Plot.ADAPTER_DISK_DB;
  const farmSize = 409600;
  const paddedDataSize = 120191;
  const numberOfPlots = 32;
  const encodingRounds = 3;
  const addresses: Uint8Array[] = [];
  for (let i = 0; i < numberOfPlots; ++i) {
    addresses.push(crypto.randomBytes(HASH_LENGTH));
  }
  const metadataStore = new Storage('rocks', storageDir, 'farm-disk');
  const farm = await Farm.open(plotMode, metadataStore, storageDir, numberOfPlots, farmSize, encodingRounds, addresses);
  const data = crypto.randomBytes(paddedDataSize);
  const paddedData = codes.padLevel(data);
  const encodedData = await codes.erasureCodeLevel(paddedData);
  const pieceSet = codes.sliceLevel(encodedData);
  const pieceHashes = pieceSet.map((piece) => crypto.hash(piece));
  const stateHash = crypto.randomBytes(HASH_LENGTH);
  const { proofs } = crypto.buildMerkleTree(pieceHashes);
  const pieces: IPiece[] = [];
  for (let i = 0; i < pieceSet.length; ++i) {
    pieces[i] = {
      piece: pieceSet[i],
      data: {
        pieceHash: pieceHashes[i],
        stateHash,
        pieceIndex: i,
        proof: proofs[i],
      },
    };
  }

  // bulk add
  await farm.seedPlot(pieces);

  // get closest
  const target = crypto.randomBytes(HASH_LENGTH);
  const closestPiece = await farm.getClosestPiece(target);
  const closestEncodings = await farm.getClosestEncodings(target);
  if (closestPiece && closestEncodings) {
    expect(pieceSet).toContainEqual(closestPiece.piece);
    expect(closestEncodings.encodings.length).toBeGreaterThan(0);
    for (let i = 0; i < closestEncodings.encodings.length; ++i) {
      expect(codes.decodePiece(closestEncodings.encodings[i], addresses[i], encodingRounds).toString()).toBe(closestPiece.piece.toString());
    }
  } else {
    fail(true);
  }

  // get exact
  const pieceId = pieceHashes[0];
  const exactPiece = await farm.getExactPiece(pieceId);
  const exactEncodings = await farm.getExactEncodings(pieceId);
  if (exactPiece && exactEncodings) {
    expect(pieceSet).toContainEqual(exactPiece.piece);
    expect(exactEncodings.encodings.length).toBeGreaterThan(0);
    for (let i = 0; i < exactEncodings.encodings.length; ++i) {
      expect(codes.decodePiece(exactEncodings.encodings[i], addresses[i], encodingRounds).toString()).toBe(exactPiece.piece.toString());
    }
  } else {
    fail(true);
  }

  // test delete
  await farm.removePieceAndEncodings(pieceId);
  const deletedExactPiece = await farm.getExactPiece(pieceId);
  expect(deletedExactPiece).toBeFalsy();
  const deletedExactEncodings = await farm.getExactEncodings(pieceId);
  expect(deletedExactEncodings).toBeFalsy();
});
