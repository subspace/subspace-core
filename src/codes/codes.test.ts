import * as crypto from '../crypto/crypto';
import * as codes from './codes';

test('pad-small-level', () => {
  // less than 4096 bytes
  const levelData = crypto.randomBytes(400);
  const paddedLevelData = codes.padLevel(levelData);
  expect(paddedLevelData.length).toBe(4096);
});

test('pad-exact-level', () => {
  // exactly 4096 bytes
  const levelData = crypto.randomBytes(4096);
  const paddedLevelData = codes.padLevel(levelData);
  expect(paddedLevelData.length).toBe(4096);
});

test('pad-large-level', () => {
  // greater than 4096 bytes, but requires padding
  const levelData = crypto.randomBytes(32000);
  const paddedLevelData = codes.padLevel(levelData);
  expect(paddedLevelData.length).toBe(32768);
});

test('erasure-code-level', async () => {
  // single source shard + single parity shard
  const data = crypto.randomBytes(4096);
  const encodedData = await codes.erasureCodeLevel(data);
  expect(encodedData.length).toBe(8192);
});

test('erasure-code-large-level', async () => {
  // eight source shards + eight parity shards
  const data = crypto.randomBytes(32768);
  const encodedData = await codes.erasureCodeLevel(data);
  expect(encodedData.length).toBe(65536);
});

test('erasure-code-overlarge-level', async () => {
  // 129 source shards + 129 parity shards
  const data = crypto.randomBytes(528384);
  await expect(codes.erasureCodeLevel(data)).rejects.toThrow();
});

test('slice-level', () => {
  // 8 source pieces
  const data = crypto.randomBytes(32768);
  const pieces = codes.sliceLevel(data);
  for (const piece of pieces) {
    expect(piece.length).toBe(4096);
  }
});

test('repair-level', async () => {
  // two source shards + two parity shards, delete one of each and reconstruct
  const seed = crypto.randomBytes(4097);
  const data = codes.padLevel(seed);
  const tag = crypto.hash(data);
  const encodedData = await codes.erasureCodeLevel(data);
  const pieceSet = codes.sliceLevel(encodedData);
  const nullPiece = new Uint8Array(4096);
  const partialData = Buffer.concat([nullPiece, pieceSet[1], pieceSet[2], nullPiece]);
  const repairedData = await codes.reconstructLevel(partialData, 2, 2, [false, true, true, false]);
  const repairedTag = crypto.hash(repairedData);
  expect(repairedTag.toString()).toBe(tag.toString());
});

const key = crypto.randomBytes(32);
const piece = crypto.randomBytes(4096);

test('encode-decode-single-round', () => {
  const encodedPiece = codes.encodePiece(piece, key, 1);
  const decodedPiece = codes.decodePiece(encodedPiece, key, 1);
  expect(piece.toString()).toBe(decodedPiece.toString());
});

test('encode-decode-two-rounds', () => {
  const encodedPiece = codes.encodePiece(piece, key, 2);
  const decodedPiece = codes.decodePiece(encodedPiece, key, 2);
  expect(piece.toString()).toBe(decodedPiece.toString());
});

test('encode-decode-three-rounds', () => {
  const encodedPiece = codes.encodePiece(piece, key, 3);
  const decodedPiece = codes.decodePiece(encodedPiece, key, 3);
  expect(piece.toString()).toBe(decodedPiece.toString());
});

test('encode-decode-128-rounds', () => {
  const encodedPiece = codes.encodePiece(piece, key, 128);
  const decodedPiece = codes.decodePiece(encodedPiece, key, 128);
  expect(piece.toString()).toBe(decodedPiece.toString());
});

test('encode-decode-512-rounds', () => {
  const encodedPiece = codes.encodePiece(piece, key, 512);
  const decodedPiece = codes.decodePiece(encodedPiece, key, 512);
  expect(piece.toString()).toBe(decodedPiece.toString());
});

// 127 pieces
const data = crypto.randomBytes(520191);
// 128 pieces
// const data = crypto.randomBytes(524287);

test('encode-full-level', async () => {
  const paddedData = codes.padLevel(data);
  const encodedData = await codes.erasureCodeLevel(paddedData);
  const pieceSet = codes.sliceLevel(encodedData);
  const encodings: Uint8Array[] = [];
  const encodedHashes: Uint8Array[] = [];
  for (const piece of pieceSet) {
    const encoding = codes.encodePiece(piece, key, 3);
    encodings.push(encoding);
    encodedHashes.push(crypto.hash(encoding));
  }
  crypto.buildMerkleTree(encodedHashes);
});
