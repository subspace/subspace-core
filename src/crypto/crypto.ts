import { jumpConsistentHash } from '@subspace/jump-consistent-hash';
import * as crypto from 'crypto';
import { Tree } from 'merkle-tree-binary';
import { IMerkleData } from '../main/interfaces';

// ToDo
  // add ECDSA keys
  // implement modular division in rust
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
  return hash(data, 32, 'sha256');
}

/**
 * Builds a merkle tree from input hashes, returning the root hash and an array of inclusion proofs.
 * Assumes trees are constant sized and known by verifier, else insecure without two hash functions
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

export function encrypt(plaintext: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const cipherText = cipher.update(plaintext);
  return Buffer.concat([cipherText, cipher.final()]);
}

export function decrypt(cipherText: Uint8Array, key: Uint8Array, iv: Uint8Array): Uint8Array {
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const plainText = decipher.update(cipherText);
  return Buffer.concat([plainText, decipher.final()]);
}
