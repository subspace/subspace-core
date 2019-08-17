  // tslint:disable: no-console

import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { Farm } from '../farm/farm';

const key = crypto.randomBytes(32);
const data = crypto.randomBytes(520191);
const paddedData = codes.padLevel(data);
const encodedData = codes.erasureCodeLevel(paddedData);
const pieceSet = codes.sliceLevel(encodedData);

test('mem-plot', async () => {
  const farm = await Farm.init('rocks', 'mem-db');

  // bulk add
  await farm.initPlot(key, pieceSet);

  // get closest
  const target = crypto.randomBytes(32);
  const closestPiece = await farm.getClosestPiece(target);
  console.log(closestPiece);
  const closestEncoding = await farm.getClosestEncoding(target);
  console.log(closestEncoding);
  if (closestPiece && closestEncoding) {
    expect(pieceSet.includes(closestPiece)).toBe(true);
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
    expect(pieceSet.includes(exactPiece)).toBe(true);
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

test('disk-plot', async () => {
  const farm = await Farm.init('rocks', 'disk-db');

  // bulk add
  await farm.initPlot(key, pieceSet);

  // get closest
  const target = crypto.randomBytes(32);
  const closestPiece = await farm.getClosestPiece(target);
  console.log(closestPiece);
  const closestEncoding = await farm.getClosestEncoding(target);
  console.log(closestEncoding);
  if (closestPiece && closestEncoding) {
    expect(pieceSet.includes(closestPiece)).toBe(true);
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
    expect(pieceSet.includes(exactPiece)).toBe(true);
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
