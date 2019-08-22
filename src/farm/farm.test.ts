  // tslint:disable: no-console

import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { Farm } from './farm';

test('mem-plot', async () => {
  const farm = await Farm.init('rocks', 'mem-db');

  const key = crypto.randomBytes(32);
  const data = crypto.randomBytes(520191);
  const paddedData = codes.padLevel(data);
  const encodedData = await codes.erasureCodeLevel(paddedData);
  const pieceSet = codes.sliceLevel(encodedData);

  // bulk add
  await farm.initPlot(key, pieceSet);

  // get closest
  const target = crypto.randomBytes(32);
  const closestPiece = await farm.getClosestPiece(target);
  const closestEncoding = await farm.getClosestEncoding(target);
  if (closestPiece && closestEncoding) {
    expect(pieceSet).toContainEqual(closestPiece);
    expect(codes.decodePiece(closestEncoding, key).toString()).toBe(closestPiece.toString());
  } else {
    fail(true);
  }

  // get exact
  const piece = pieceSet[0];
  const pieceId = crypto.hash(piece);
  const exactPiece = await farm.getExactPiece(pieceId);
  const exactEncoding = await farm.getExactEncoding(pieceId);
  if (exactPiece && exactEncoding) {
    expect(pieceSet).toContainEqual(exactPiece);
    expect(codes.decodePiece(exactEncoding, key).toString()).toBe(exactPiece.toString());
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

// test('disk-plot', async () => {
//   const farm = await Farm.init('rocks', 'disk-db');
//   const key = crypto.randomBytes(32);
//   const data = crypto.randomBytes(520191);
//   const paddedData = codes.padLevel(data);
//   const encodedData = await codes.erasureCodeLevel(paddedData);
//   const pieceSet = codes.sliceLevel(encodedData);

//   // bulk add
//   await farm.initPlot(key, pieceSet);

//   // get closest
//   const target = crypto.randomBytes(32);
//   const closestPiece = await farm.getClosestPiece(target);
//   const closestEncoding = await farm.getClosestEncoding(target);
//   if (closestPiece && closestEncoding) {
//     expect(pieceSet).toContainEqual(closestPiece);
//     expect(codes.decodePiece(closestEncoding, key).toString()).toBe(closestPiece.toString());
//   } else {
//     fail(true);
//   }

//   // get exact
//   const piece = pieceSet[0];
//   const pieceId = crypto.hash(piece);
//   const exactPiece = await farm.getExactPiece(pieceId);
//   const exactEncoding = await farm.getExactEncoding(pieceId);
//   if (exactPiece && exactEncoding) {
//     expect(pieceSet).toContainEqual(exactPiece);
//     expect(codes.decodePiece(exactEncoding, key).toString()).toBe(exactPiece.toString());
//   } else {
//     fail(true);
//   }

//   // test delete
//   await farm.removePiece(pieceId);
//   const exactPiece1 = await farm.getExactPiece(pieceId);
//   const exactEncoding1 = await farm.getExactEncoding(pieceId);
//   if (exactPiece1 || exactEncoding1) {
//     fail(true);
//   }
// });
