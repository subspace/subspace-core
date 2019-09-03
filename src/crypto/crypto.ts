import { jumpConsistentHash } from '@subspace/jump-consistent-hash';
import { AggregationInfo, PrivateKey, PublicKey, Signature } from 'bls-signatures';
import * as crypto from 'crypto';
import { Tree } from 'merkle-tree-binary';
import { IKeyPair, IMerkleData} from '../main/interfaces';

// ToDo
  // rewrite JCH in Rust (Nazar)
  // rewrite merkle tree in Rust (Nazar)
  // aggregate signatures and public keys (Jeremiah)

/**
 * Returns a binary sequence of random bytes, using native Node JS crypto.
 */
export function randomBytes(length: number): Uint8Array {
  return new Uint8Array(crypto.randomBytes(length));
}

/**
 * Returns the binary hash of a binary value. Hash function and output length are configurable.
 */
export function hash(data: Uint8Array, outputLength = 32, type = 'sha256'): Uint8Array {
  const hasher = crypto.createHash(type);
  hasher.update(data);
  let hash = new Uint8Array(hasher.digest());
  hash = hash.subarray(0, outputLength);
  return hash;
}

function merkleHash(data: Uint8Array): Uint8Array {
  return hash(data, 32, 'whirlpool');
}

/**
 * Builds a merkle tree from input hashes, returning the root hash and an array of inclusion proofs.
 */
export function buildMerkleTree(items: Uint8Array[]): IMerkleData {
  const tree = new Tree(items, merkleHash);
  const root = tree.getRoot();
  const proofs: Uint8Array[] = [];

  for (const item of items) {
    proofs.push(tree.getProof(item));
  }

  return { root, proofs };
}

/**
 * Validates that a merkle proof is valid for a given root.
 */
export function isValidMerkleProof(root: Uint8Array, proof: Uint8Array, item: Uint8Array): boolean {
  return Tree.checkProof(root, proof, item, merkleHash);
}

/**
 * Returns a pseudo-random number within a specified range, from a binary seed.
 */
export function jumpHash(seed: Uint8Array, buckets: number): number {
  return jumpConsistentHash(seed, buckets);
}

/**
 * Checks if a unix timestamp is within a specified time range.
 */
export function isDateWithinRange(date: number, range: number): boolean {
  // checks to ensure a supplied unix timestamp is within a supplied range
  return Math.abs(Date.now() - date) <= range;
}

/**
 * Returns a BLS-381 public/private key pair from a binary seed.
 */
export function generateBLSKeys(seed?: Uint8Array): IKeyPair {
  if (!seed) {
    seed = crypto.randomBytes(32);
  }
  const privateKey = PrivateKey.fromSeed(seed);
  const publicKey = privateKey.getPublicKey();
  const binaryPrivateKey = privateKey.serialize();
  const binaryPublicKey = publicKey.serialize();
  return { binaryPrivateKey, binaryPublicKey };
}

/**
 * Signs the hash of a binary message given a BLS private key.
 */
export function signMessage(binaryMessage: Uint8Array, binaryPrivateKey: Uint8Array): Uint8Array {
  const messageHash = hash(binaryMessage);
  const privateKey = PrivateKey.fromBytes(binaryPrivateKey, false);
  const signature = privateKey.sign(messageHash);
  const binarySignature = signature.serialize();
  signature.delete();
  privateKey.delete();
  return binarySignature;
}

/**
 * Verifies a BLS signature given a binary message and BLS public key.
 */
export function verifySignature(binaryMessage: Uint8Array, binarySignature: Uint8Array, binaryPublicKey: Uint8Array): boolean {
  const signature = Signature.fromBytes(binarySignature);
  const publicKey = PublicKey.fromBytes(binaryPublicKey);
  const messageHash = hash(binaryMessage);
  const aggregationInfo = AggregationInfo.fromMsg(publicKey, messageHash);
  signature.setAggregationInfo(aggregationInfo);
  const isValid = signature.verify();
  signature.delete();
  publicKey.delete();
  aggregationInfo.delete();
  return isValid;
}
