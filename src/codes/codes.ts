// tslint:disable: object-literal-sort-keys

import { ReedSolomonErasure } from "@subspace/reed-solomon-erasure.wasm";
import * as crypto from '../crypto/crypto';
import { State } from "../ledger/state";
import { BLOCKS_PER_PIECE, DIFFICULTY, HASH_LENGTH, PIECE_SIZE, ROUNDS, VERSION } from '../main/constants';
import { IPiece } from "../main/interfaces";
import { xorUint8Array } from '../utils/utils';

// ToDo
  // optimize/import encode/decode in Rust
  // actual hourglass function (from filecoin rust proofs?)

/**
 * Adds deterministic hashes to a piece s.t. it is a exactly 4096 bytes.
 */
export function padPiece(piece: Uint8Array): Uint8Array {
  const paddingLength = PIECE_SIZE - piece.length;
  const numberOfFullHashes = Math.floor(paddingLength / HASH_LENGTH);
  const lastPartialHashLength = paddingLength % HASH_LENGTH;

  let hashPad = crypto.hash(piece);
  const hashPads: Uint8Array[] = [];
  for (let i = 0; i < numberOfFullHashes; ++i) {
    hashPads.push(hashPad);
    hashPad = crypto.hash(hashPad);
  }

  hashPads.push(hashPad.subarray(0, lastPartialHashLength));
  const hashPadding = Buffer.concat(hashPads);

  return Buffer.concat([piece, hashPadding]);
}

/**
 * Adds deterministic hashes to level source data s.t. it is a multiple of 4096 bytes.
 */
export function padLevel(levelData: Uint8Array): Uint8Array {
  const numberOfFullPieces = Math.floor(levelData.length / PIECE_SIZE);
  const finalPieceLength = levelData.length % PIECE_SIZE;
  if (finalPieceLength) {
    const lastPartialPiece = levelData.subarray(PIECE_SIZE * numberOfFullPieces);
    const padding = padPiece(lastPartialPiece);
    levelData = Buffer.concat([levelData.subarray(0, PIECE_SIZE * numberOfFullPieces), padding]);
  }
  return Uint8Array.from(levelData);
}

/**
 * Creates a new state block and piece set from pending state data.
 *
 * @param stateData pending state from previous confirmed levels (block proofs, contents, and txs)
 * @param previousStateHash hash of the last state block
 * @param timestamp time for the last coinbase tx
 *
 * @return a valid state instance and an array of new pieces with metadata for plotting
 */
export async function encodeState(stateData: Uint8Array, previousStateHash: Uint8Array, timestamp: number): Promise<{state: State, pieceDataSet: IPiece[]}> {

  // ensure source data is correct length
  if (stateData.length !== (4096 * 127)) {
    throw new Error('Cannot encode state, state must be exactly 520,192 bytes');
  }

  // erasure code state x2 into 127 source pieces and 127 parity pieces
  const erasureCodedData = await erasureCodeState(stateData);

  // slice erasure coded data into 254 discrete pieces
  const pieces = sliceState(erasureCodedData);

  // compute the piece hashes for merkle tree and piece metadata
  const pieceHashes = pieces.map((piece) => crypto.hash(piece));

  // create source and parity index pieces
  const indexData = Buffer.concat([...pieceHashes]);
  const sourceIndexPiece = Buffer.concat([indexData.subarray(0, 4064), new Uint8Array(32)]);
  const sourceIndexPieceHash = crypto.hash(sourceIndexPiece);
  const parityIndexPiece = Buffer.concat([indexData.subarray(4064), new Uint8Array(32)]);
  const parityIndexPieceHash = crypto.hash(parityIndexPiece);
  pieces.push(sourceIndexPiece);
  pieceHashes.push(sourceIndexPieceHash);
  pieces.push(parityIndexPiece);
  pieceHashes.push(parityIndexPieceHash);

  // build the merkle tree
  const { root, proofs } = crypto.buildMerkleTree(pieceHashes);

  // create state
  const state = State.create(
    previousStateHash,
    root,
    sourceIndexPieceHash,
    parityIndexPieceHash,
    timestamp,
    DIFFICULTY,
    VERSION,
  );

  // compile piece data
  const pieceDataSet: IPiece[] = [];
  for (let i = 0; i < pieces.length; ++i) {
    pieceDataSet[i] = {
      piece: pieces[i],
      data: {
        pieceHash: pieceHashes[i],
        stateHash: state.key,
        pieceIndex: i,
        proof: proofs[i],
      },
    };
  }

  return { state, pieceDataSet };
}

const readSolomonErasure = ReedSolomonErasure.fromCurrentDirectory();

const SHARD_SIZE = PIECE_SIZE;

/**
 * Returns the Reed-Solomon erasure coding of source data.
 *
 * @param data the source data to be erasure coded
 *
 * @return the source data combined with parity data
 */
export async function erasureCodeState(data: Uint8Array): Promise<Uint8Array> {
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
 *
 * @param erasureCodedLevelData the raw buffer of the erasure coded data output
 *
 * @return an array of constant sized pieces constructed from the input data
 *
 */
export function sliceState(erasureCodedLevelData: Uint8Array): Uint8Array[] {
  const pieceCount = erasureCodedLevelData.length / PIECE_SIZE;
  const pieceSet: Uint8Array[] = [];
  for (let i = 0; i < pieceCount; ++i) {
    const piece = erasureCodedLevelData.subarray(i * PIECE_SIZE, (i + 1) * PIECE_SIZE);
    pieceSet.push(Uint8Array.from(piece));
  }
  return pieceSet;
}

/**
 * Reconstructs the source data of an erasure coding given a sufficient number of pieces.
 */
export async function reconstructState(data: Uint8Array, DATA_SHARDS: number, PARITY_SHARDS: number, shardsAvailable: boolean[]): Promise<Uint8Array> {
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
          // encode the first block of subsequent rounds with the last encoded block of the previous round
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
