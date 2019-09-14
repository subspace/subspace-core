/**
 * @jest-environment node
 */

import {BlsSignatures} from "./BlsSignatures";
import * as crypto from './crypto';

const hashData = Buffer.from('hello subspace');
const hashValue = "00ba5188adff22ee1f8abc61d6e96c371f0d505ec76f90e86d4b0c8748d646bb";

const treeData = [
  Buffer.from('acadda60a86d56e836b3df33c0bd3205d7e0f0ffb12733b44866917582286cde', 'hex'),
  Buffer.from('7f5f00f1199c45329d4e101bb8160f5c2d47998e87ec2520f7a8146250375a3d', 'hex'),
];

const treeRoot = 'b4d8c975f0019b9e41b7809c2c08bed92038898b0ed132f9b10d788cc46f2433';
const treeProofs = [
  '007f5f00f1199c45329d4e101bb8160f5c2d47998e87ec2520f7a8146250375a3d',
  '01acadda60a86d56e836b3df33c0bd3205d7e0f0ffb12733b44866917582286cde',
];

const tree = crypto.buildMerkleTree(treeData);

const jumpHashRange = 1024;
const jumpHashBucket = 189;

const binaryPrivateKey = Uint8Array.from([
  41,   6,  34, 247,  40, 218,  26, 234,
171, 103, 167,  93,  86, 228, 244, 243,
   8, 139, 135, 241, 238, 234,  60,  91,
 141, 113, 255,  10, 236, 199, 143, 198]);

const binaryPublicKey = Uint8Array.from([
  130, 166, 154,  66, 114, 162, 145, 245, 206,
  135,  72, 219, 242, 186, 150,  94,  22, 250,
  202,  19,  79, 192, 116, 184, 184,  97, 218,
   64, 123, 125, 185, 202, 121,  48, 244,  26,
   87,  29,  83, 221,  21, 204, 141, 124,  30,
   36, 152, 254]);

const dateRange = 1000;

let blsSignatures: BlsSignatures;

beforeAll(async () => {
  blsSignatures = await BlsSignatures.init();
});

test('sha-256-hash', () => {
  expect(Buffer.from(crypto.hash(hashData)).toString('hex')).toBe(hashValue);
});

test('merkle-root', () => {
  expect(Buffer.from(tree.root).toString('hex')).toBe(treeRoot);
});

test('merkle-proofs', () => {
  tree.proofs.forEach((proof, index) => {
    expect(Buffer.from(proof).toString('hex')).toBe(treeProofs[index]);
  });
});

test('jump-hash', () => {
  expect(crypto.jumpHash(Buffer.from(hashValue, 'hex'), jumpHashRange)).toBe(jumpHashBucket);
});

test('valid-date', () => {
  const date = Date.now();
  expect(crypto.isDateWithinRange(date, dateRange)).toBe(true);
});

test('invalid-date', () => {
  const date = Date.now() - 10000;
  expect(crypto.isDateWithinRange(date, dateRange)).toBe(false);
});

test('bls-keys', () => {
  const keyPair = blsSignatures.generateBLSKeys();
  const signature = blsSignatures.signMessage(Buffer.from(hashValue), keyPair.binaryPrivateKey);
  expect(blsSignatures.verifySignature(Buffer.from(hashValue), signature, keyPair.binaryPublicKey)).toBe(true);

  const signature1 = blsSignatures.signMessage(Buffer.from(hashValue), binaryPrivateKey);
  expect(blsSignatures.verifySignature(Buffer.from(hashValue), signature1, binaryPublicKey)).toBe(true);
});

test('merkle-workflow', () => {
  const leaves: Uint8Array[] = [
    crypto.randomBytes(32),
    crypto.randomBytes(32),
    crypto.randomBytes(32),
    crypto.randomBytes(32),
  ];

  const { root, proofs } = crypto.buildMerkleTree(leaves);

  for (let i = 0; i < leaves.length; ++i) {
    expect(crypto.isValidMerkleProof(root, proofs[i], leaves[i])).toBe(true);
  }
});
