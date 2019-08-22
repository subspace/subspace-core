import { ReedSolomonErasure } from "@subspace/reed-solomon-erasure.wasm";
import { BLOCKS_PER_PIECE, HASH_LENGTH, PIECE_SIZE, ROUNDS} from '../main/constants';
import { xorUint8Array } from '../utils/utils';

// ToDo
  // optimize/import encode/decode in Rust
  // actual hourglass function (from filecoin rust proofs?)

export function padPiece(piece: Uint8Array): Uint8Array {
  const remainder = piece.length % PIECE_SIZE;
  if (remainder) {
    const padding = new Uint8Array(PIECE_SIZE - remainder);
    piece = Buffer.concat([piece, padding]);
  }
  return piece;
}

/**
 * Adds trailing 0s to level source data s.t. it is a multiple of 4096 bytes.
 */
export function padLevel(levelData: Uint8Array): Uint8Array {
  const remainder = levelData.length % PIECE_SIZE;
  if (remainder) {
    const padding = new Uint8Array(PIECE_SIZE - remainder);
    levelData = Buffer.concat([levelData, padding]);
  }
  return levelData;
}

const readSolomonErasure = ReedSolomonErasure.fromCurrentDirectory();

const SHARD_SIZE = PIECE_SIZE;

/**
 * Returns the Reed-Solomon erasure coding of source data.
 */
export async function erasureCodeLevel(data: Uint8Array): Promise<Uint8Array> {
  const DATA_SHARDS = data.length / SHARD_SIZE;
  const PARITY_SHARDS = DATA_SHARDS;

  if (DATA_SHARDS + PARITY_SHARDS > 254) {
    throw new Error('Cannot create more than 254 shards');
  }

  const shards = new Uint8Array(SHARD_SIZE * (DATA_SHARDS + PARITY_SHARDS));
  shards.set(data);
  const result = (await readSolomonErasure).encode(shards, DATA_SHARDS, PARITY_SHARDS);
  if (result !== ReedSolomonErasure.RESULT_OK) {
    throw new Error(`Erasure coding failed with code ${result}`);
  }
  return shards;
}

/**
 * Converts erasure coded data into a set of fixed length pieces.
 */
export function sliceLevel(erasureCodedLevelData: Uint8Array): Uint8Array[] {
  const pieceCount = erasureCodedLevelData.length / PIECE_SIZE;
  const pieceSet: Uint8Array[] = [];
  for (let i = 0; i < pieceCount; ++i) {
    const piece = erasureCodedLevelData.subarray(i * PIECE_SIZE, (i + 1) * PIECE_SIZE);
    pieceSet.push(piece);
  }
  return pieceSet;
}

/**
 * Reconstructs the source data of an erasure coding given a sufficient number of pieces.
 */
export async function reconstructLevel(data: Uint8Array, DATA_SHARDS: number, PARITY_SHARDS: number, shardsAvailable: boolean[]): Promise<Uint8Array> {
  const shards = data.slice();
  const result = (await readSolomonErasure).reconstruct(shards, DATA_SHARDS, PARITY_SHARDS, shardsAvailable);
  if (result !== ReedSolomonErasure.RESULT_OK) {
    throw new Error(`Erasure coding reconstruction failed with code ${result}`);
  }
  return shards.subarray(0, SHARD_SIZE * DATA_SHARDS);
}

/**
 * Encodes a piece with a key using a simple XOR based Chained Block Cipher (CBC-XOR).
 * TODO: Create a faster implementation in Rust.
 */
export function encodePiece(piece: Uint8Array, key: Uint8Array, rounds = ROUNDS): Uint8Array {
  const output = new Uint8Array(piece);
  // variable round cipherless chain block encoding using node id as the initialization vector
  for (let r = 0; r < rounds; ++r) {
      if (!r) {
          // encode the first block of the first round with the key
          const encodedFirstBlock = xorUint8Array(output.subarray(0, HASH_LENGTH), key);
          output.set(encodedFirstBlock, 0);
      } else {
          // encode the first block of subsequent rounds with the final encoded block of the previous round
          const finalEncodedBlock = output.subarray(HASH_LENGTH * (BLOCKS_PER_PIECE - 1), HASH_LENGTH * BLOCKS_PER_PIECE);
          const originalFirstBlock = output.subarray(0, HASH_LENGTH);
          const encodedFirstBlock = xorUint8Array(finalEncodedBlock, originalFirstBlock);
          output.set(encodedFirstBlock, 0);
      }

      for (let b = 1; b < BLOCKS_PER_PIECE; ++b) {
          // encode each following block with its preceding block
          const previousEncodedBlock = output.subarray(HASH_LENGTH * (b - 1), (HASH_LENGTH * b));
          const originalBlock = output.subarray(HASH_LENGTH * b, HASH_LENGTH * (b + 1));
          const encodedBlock = xorUint8Array(previousEncodedBlock, originalBlock);
          output.set(encodedBlock, HASH_LENGTH * b);
      }
  }
  return output;
}

/**
 * Returns the original piece, given an encoding and a key by applying CBC-XOR in reverse.
 * TODO: Create a faster implementation in Rust, that decodes in //.
 */
export function decodePiece(encodedPiece: Uint8Array, key: Uint8Array, rounds = ROUNDS): Uint8Array {
  const output = new Uint8Array(encodedPiece);
  // variable round cipherless chain block decoding using node id as the initialization vector
  for (let r = rounds; r > 0; --r) {
      for (let b = BLOCKS_PER_PIECE; b > 1; --b) {
          // decode each block using its current state and its encoded predecessor
          const previousEncodedBlock = output.subarray(HASH_LENGTH * (b - 2), HASH_LENGTH * (b - 1));
          const encodedBlock = output.subarray(HASH_LENGTH * (b - 1), HASH_LENGTH * b);
          const decodedBlock = xorUint8Array(previousEncodedBlock, encodedBlock);
          output.set(decodedBlock, HASH_LENGTH * (b - 1));
      }

      if (r === 1) {
          // if the final round, decode the first block with its current state and the key
          const decodedFirstBlock = xorUint8Array(output.subarray(0, HASH_LENGTH), key);
          output.set(decodedFirstBlock, 0);
      } else {
          // if any other round, decode the first block with its current state and the final encoded block of the message
          const lastEncodedBlock = output.subarray(HASH_LENGTH * (BLOCKS_PER_PIECE - 1), HASH_LENGTH * BLOCKS_PER_PIECE);
          const encodedFirstBlock = output.subarray(0, HASH_LENGTH);
          const decodedFirstBlock = xorUint8Array(lastEncodedBlock, encodedFirstBlock);
          output.set(decodedFirstBlock, 0);
      }
  }
  return output;
}

/**
 * TODO: Encodes a piece with an hourglass function that is efficiently invertible.
 */
export function sealPiece(piece: Uint8Array): Uint8Array {
  return piece;
}

/**
 * TODO: Efficiently returns the original piece.
 */
export function openPiece(sealedPiece: Uint8Array): Uint8Array {
  return sealedPiece;
}
