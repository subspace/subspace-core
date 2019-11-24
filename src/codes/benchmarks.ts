// tslint:disable: no-console
import * as crypto from '../crypto/crypto';
import * as codes from './codes';

const ROUNDS = 3;

const piece = crypto.randomBytes(4096);
const pieceId = crypto.hash(piece);
const key = crypto.randomBytes(32);

const encodeStart = Date.now();
const encoding = codes.encodePiece(piece, key, ROUNDS);
const encodeTime = Date.now() - encodeStart;
console.log(`Encode time is ${encodeTime} ms`);

const decodeStart = Date.now();
codes.decodePiece(encoding, key, ROUNDS);
const decodeTime = Date.now() - decodeStart;
console.log(`Decode time is ${decodeTime} ms`);

const encryptStart = Date.now();
const encryption = codes.encryptPiece(piece, pieceId, key, ROUNDS);
const encryptTime = Date.now() - encryptStart;
console.log(`Encrypt time is ${encryptTime} ms`);

const decryptStart = Date.now();
codes.decryptPiece(encryption, pieceId, key, ROUNDS);
const decryptTime = Date.now() - decryptStart;
console.log(`Decrypt time is ${decryptTime} ms`);
