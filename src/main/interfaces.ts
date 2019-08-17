export interface IStateValue {
  previousStateHash: Uint8Array; // hash of the previous state (32 bytes)
  levelHash: Uint8Array; // hash of the concatenation of all proofs for the last full level (32 bytes)
  pieceRoot: Uint8Array; // merkle root of the piece set for the last full level (32 bytes)
  timestamp: number; // UNIX time (4 bytes) of last block added to level
  difficulty: number; // piece audit scope or range (4 bytes) based on last level
  version: number; // protocol version of last level (1 bytes)
  indexPiece: Uint8Array;
}

export type IStateData = [Uint8Array, Uint8Array, Uint8Array, number, number, number, Uint8Array];

export interface IBlockValue {
  proof: IProofValue;
  content: IContentValue;
  txs: ITxValue[];
}

export type IBlockData = [IProofData, IContentData];

export interface ICompactBlockValue {
  proofHash: Uint8Array;
  contentHash: Uint8Array;
}

export type ICompactBlockData = [Uint8Array, Uint8Array];

export interface IProofValue {
  previousLevelHash: Uint8Array; // hash of all proofs in the previous level (32 bytes)
  previousProofHash: Uint8Array;  // hash of the last unconfirmed proof seen
  solution: Uint8Array; // closest encoded chunk to encoding target (8 bytes)
  pieceHash: Uint8Array; // original piece id of encoding that includes the solution (32 bytes)
  pieceLevel: number; // state level to obtain the merkle root for this piece
  pieceProof: Uint8Array; // merkle proof that piece is in that past level (??? bytes)
  publicKey: Uint8Array; // public key of node creating proof (32 bytes)
  signature: Uint8Array; // detached signature of this proof with node's private key (32 bytes)
}

export type IProofData = [ Uint8Array, Uint8Array, Uint8Array, Uint8Array, number, Uint8Array, Uint8Array, Uint8Array ];

export interface IContentValue {
  parentContentHash: Uint8Array; // hash of parent content block (32 bytes)
  proofHash: Uint8Array; // hash of proof for this block (32 bytes)
  payload: Uint8Array[]; // all txs in this block (for now)
}

export type IContentData = [Uint8Array, Uint8Array, Uint8Array[]];

export interface ITxValue {
  sender: Uint8Array; // public key of sender
  receiver: Uint8Array; // address of receiver
  amount: number; // number of credits being sent
  nonce: number; // auto incrementing tx nonce for the sender
  timestamp: number; // create at unix timestamp
  signature: Uint8Array; // detached signature with sender's private key
}

export type ITxData = [ Uint8Array, Uint8Array, number, number, number, Uint8Array ];

export interface ISolution {
  pieceHash: Uint8Array;
  encodedChunk: Uint8Array;
  encodedPiece: Uint8Array;
  pieceProof: Uint8Array;
}

export interface IPieceData {
  piece: Uint8Array;
  proof: Uint8Array;
  index: number;
}

export interface IEncodingData {
  encoding: Uint8Array;
  proof: Uint8Array;
  index: number;
}

export interface IKeyPair {
  binaryPrivateKey: Uint8Array;
  binaryPublicKey: Uint8Array;
}

export interface IMerkleData {
  root: Uint8Array;
  proofs: Uint8Array[];
}

export interface IPlotData {
  address: Uint8Array;
  offset: number;
  path: string;
}
