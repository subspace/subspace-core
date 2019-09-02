if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}
// tslint:disable: object-literal-sort-keys

import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { IPiece } from '../main/interfaces';
import { Farm } from './farm';

test('mem-plot', async () => {
  const address = crypto.randomBytes(32);
  const farm = await Farm.init(address, 'memory', 'mem-db');
  const data = crypto.randomBytes(520191);
  const paddedData = codes.padLevel(data);
  const encodedData = await codes.erasureCodeLevel(paddedData);
  const pieceSet = codes.sliceLevel(encodedData);
  const pieceHashes = pieceSet.map((piece) => crypto.hash(piece));
  const stateHash = crypto.randomBytes(32);
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
  const target = crypto.randomBytes(32);
  const closestPiece = await farm.getClosestPiece(target);
  const closestEncoding = await farm.getClosestEncoding(target);
  if (closestPiece && closestEncoding) {
    expect(pieceSet).toContainEqual(closestPiece.piece);
    expect(codes.decodePiece(closestEncoding.encoding, address).toString()).toBe(closestPiece.piece.toString());
  } else {
    fail(true);
  }

  // get exact
  const pieceId = pieceHashes[0];
  const exactPiece = await farm.getExactPiece(pieceId);
  const exactEncoding = await farm.getExactEncoding(pieceId);
  if (exactPiece && exactEncoding) {
    expect(pieceSet).toContainEqual(exactPiece.piece);
    expect(codes.decodePiece(exactEncoding.encoding, address).toString()).toBe(exactPiece.piece.toString());
  } else {
    fail(true);
  }

  // test delete
  await farm.removePiece(pieceId);
  const exactPiece1 = await farm.getExactPiece(pieceId);
  const exactEncoding1 = await farm.getExactEncoding(pieceId);
  if (exactPiece1 || exactEncoding1) {
    fail(true);
  }
});

test('disk-plot', async () => {
  const address = crypto.randomBytes(32);
  const farm = await Farm.init(address, 'rocks', 'disk-db');
  const data = crypto.randomBytes(520191);
  const paddedData = codes.padLevel(data);
  const encodedData = await codes.erasureCodeLevel(paddedData);
  const pieceSet = codes.sliceLevel(encodedData);
  const pieceHashes = pieceSet.map((piece) => crypto.hash(piece));
  const stateHash = crypto.randomBytes(32);
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
  const target = crypto.randomBytes(32);
  const closestPiece = await farm.getClosestPiece(target);
  const closestEncoding = await farm.getClosestEncoding(target);
  if (closestPiece && closestEncoding) {
    expect(pieceSet).toContainEqual(closestPiece.piece);
    expect(codes.decodePiece(closestEncoding.encoding, address).toString()).toBe(closestPiece.piece.toString());
  } else {
    fail(true);
  }

  // get exact
  const pieceId = pieceHashes[0];
  const exactPiece = await farm.getExactPiece(pieceId);
  const exactEncoding = await farm.getExactEncoding(pieceId);
  if (exactPiece && exactEncoding) {
    expect(pieceSet).toContainEqual(exactPiece.piece);
    expect(codes.decodePiece(exactEncoding.encoding, address).toString()).toBe(exactPiece.piece.toString());
  } else {
    fail(true);
  }

  // test delete
  await farm.removePiece(pieceId);
  const exactPiece1 = await farm.getExactPiece(pieceId);
  const exactEncoding1 = await farm.getExactEncoding(pieceId);
  if (exactPiece1 || exactEncoding1) {
    fail(true);
  }
});
