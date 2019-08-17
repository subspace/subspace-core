// tslint:disable: no-console
import * as crypto from '../crypto/crypto';
import * as codes from './codes';

const ROUNDS = 4096;

const piece = crypto.randomBytes(4096);
const key = crypto.randomBytes(32);

const encodeStart = Date.now();
const encoding = codes.encodePiece(piece, key, ROUNDS);
const encodeTime = Date.now() - encodeStart;
console.log(`Encode time is ${encodeTime} ms`);

const decodeStart = Date.now();
const decoding = codes.decodePiece(encoding, key, ROUNDS);
const decodeTime = Date.now() - decodeStart;
console.log(`Decode time is ${decodeTime} ms`);
