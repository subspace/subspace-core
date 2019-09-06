import { Content } from "../ledger/content";
import { Proof } from "../ledger/proof";
import { Tx } from '../ledger/tx';

/**
 * Summary of all Blocks in a Level, compressed into a State Block that is tracked within a single State Chain by light clients.
 */
export interface IStateValue {
  previousStateHash: Uint8Array; // hash of the previous state (32 bytes)
  levelHash: Uint8Array; // hash of the concatenation of all proofs for the last full level (32 bytes)
  pieceRoot: Uint8Array; // merkle root of the piece set for the last full level (32 bytes)
  timestamp: number; // UNIX time (4 bytes) of last block added to level
  difficulty: number; // piece audit scope or range (4 bytes) based on last level
  version: number; // protocol version of last level (2 bytes)
  indexPiece: Uint8Array;
}

/**
 * Compact representation of a State value.
 */
export type IStateData = [Uint8Array, Uint8Array, Uint8Array, number, number, number, Uint8Array];

/**
 * A logical Block contains a Proof, Content, and an array of Txs.
 */

export interface IFullBlockValue {
   proof: Proof;
   content: Content;
   coinbase?: Tx;
 }

// export interface IBlockValue {
//   proof: IProofValue;
//   content: IContentValue;
//   coinbase?: ITxValue;
// }

/**
 * Compact representation of a Block value.
 */
export type IBlockData = [IProofData, IContentData, ITxData?];

/**
 * An even smaller representation of a Block as pointers to store within Chain objects held in memory.
 */
export interface ICompactBlockValue {
  proofHash: Uint8Array;
  contentHash: Uint8Array;
}

/**
 * Compact representation of a compact Block.
 */
export type ICompactBlockData = [Uint8Array, Uint8Array];

/**
 * A canonical (non-malleable / unique) Proof of storage in response to a ledger challenge.
 * 252 bytes + merkle proof
 */
export interface IProofValue {
  previousLevelHash: Uint8Array; // 32 byte hash of all proofs in the previous level
  previousProofHash: Uint8Array;  // 32 byte hash of the last unconfirmed proof seen
  solution: Uint8Array; // 8 byte encoded chunk closest to encoding target
  pieceHash: Uint8Array; // 32 byte original piece id of encoding that includes the solution
  pieceStateHash: Uint8Array; // 32 byte state hash from which to obtain the merkle root for the piece used in this proof
  pieceProof: Uint8Array; // unknown length merkle proof that piece is in that past level
  publicKey: Uint8Array; // 48 byte public key of node creating proof
  signature: Uint8Array; // 96 byte detached signature of this proof with node's private key
}

/**
 * Compact representation of a Proof value.
 */
export type IProofData = [ Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array ];

/**
 * The malleable content associated with a block that includes a summary of Tx ids, not the Tx values themselves.
 * 64 bytes + (32 * # txs in block)
 * Max size needs to be set...
 */
export interface IContentValue {
  parentContentHash: Uint8Array; // 32 byte hash of parent content block
  proofHash: Uint8Array; // 32 byte hash of proof for this block
  payload: Uint8Array[]; // Array of all 32 byte tx ids in this block
}

/**
 * Compact representation of a Content value.
 */
export type IContentData = [Uint8Array, Uint8Array, Uint8Array[]];

/**
 * The value of a simple credit Tx.
 * Coinbase tx is 150 bytes.
 * Credit tx is 198 bytes.
 * Data tx (toDo) is max 4096 bytes
 */
export interface ITxValue {
  sender: Uint8Array; // 48 byte public key of sender (optional)
  receiver: Uint8Array; // 48 byte address of receiver
  amount: number; // 4 byte number of credits being sent
  nonce: number; // 2 byte auto incrementing tx nonce for the sender
  timestamp: number; // 4 byte a unix timestamp
  signature: Uint8Array; // 96 byte detached signature with sender's private key (credit tx) or receivers private key (coinbase tx)
}

/**
 * Compact representation of a Tx value.
 */
export type ITxData = [ Uint8Array, Uint8Array, number, number, number, Uint8Array ];

/**
 * The solution to a block challenge returned from Farm, used to create a Proof.
 */
export interface ISolution {
  pieceHash: Uint8Array;
  encodedChunk: Uint8Array;
  encodedPiece: Uint8Array;
  pieceProof: Uint8Array;
}

/**
 * Wrapper for Piece and all metadata.
 */
export interface IPiece {
  piece: Uint8Array;
  data: IPieceData;
}

/**
 * Wrapper for Encoding and all metadata.
 */
export interface IEncoding {
  encoding: Uint8Array;
  data: IPieceData;
}

/**
 * Wrapper for Encoding and all metadata.
 */
export interface IEncodingSet {
  encodings: Uint8Array[];
  data: IPieceData;
}

/**
 * Metadata associated with Piece required for Proofs and reconstructing Levels.
 */
export interface IPieceData {
  pieceHash: Uint8Array;
  stateHash: Uint8Array;
  pieceIndex: number;
  proof: Uint8Array;
}

/**
 * A BLS public and private key pair.
 */
export interface IKeyPair {
  binaryPrivateKey: Uint8Array;
  binaryPublicKey: Uint8Array;
}

/**
 * The metadata associated with a merkle tree of some Piece set.
 */
export interface IMerkleData {
  root: Uint8Array;
  proofs: Uint8Array[];
}

/**
 * The metadata associated with a Plot within the Farm.
 */
export interface IPlotData {
  address: Uint8Array;
  offset: number;
  path: string;
}
