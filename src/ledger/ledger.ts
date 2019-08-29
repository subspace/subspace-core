// tslint:disable: max-classes-per-file
// tslint:disable: object-literal-sort-keys

import { EventEmitter } from 'events';
import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { DIFFICULTY, HASH_LENGTH, PIECE_SIZE, VERSION } from '../main/constants';
import {ICompactBlockData, IContentData, IPiece, IProofData, IStateData, ITxData} from '../main/interfaces';
import { Storage } from '../storage/storage';
import { num2Bin } from '../utils/utils';
import { Account } from './accounts';
import { Block } from './block';
import { Chain } from './chain';
import { Content } from './content';
import { Proof } from './proof';
import { State } from './state';
import { Tx } from './tx';

// ToDo
  // handle chain forks
  // handle level forks
  // decode level data
  // Refactor Level into a separate class
  // handle tx fees
  // handle validation where one farmer computes the next level and adds pieces before another
  // enforce a maximum block size of 4096 bytes

// Basic Modes
  // do I store the chain data (full node)
  // do I store the piece set (plotting)
  // do I store the state chain (light client, full node, farmer)

// Implementation
  // 1) Store the entire ledger in memory, create state blocks for each new level, encode and plot
  // 2) Only store the ledger in memory and create new state blocks
  // 3) Just store the state blocks, discard new blocks once they are created
  // 4) Store each chain state to disk after N levels are confirmed
  // 5) Discard each new block after N levels are confirmed

// modes of operation
  // light client -- only stores the state chain, discards all level data after it is compressed
  // full node -- stores the full tx and block history (in memory or on disk)
  // farmer -- only stores the state chain but  encodes each new level into their plot
  // gateway node -- answers rpc requests for records over the DHT
  // farmer -- answers rpc requests for pieces

export class Ledger extends EventEmitter {

  public static async init(storageAdapter: string): Promise<Ledger> {
    const ledger = new Ledger(storageAdapter, 'ledger');
    return ledger;
  }

  public isFarming = true;
  public isServing = true;

  public previousLevelHash = new Uint8Array();
  public parentProofHash = new Uint8Array();

  // persistent state
  public chainCount = 0;
  public readonly lastConfirmedLevel = 0;
  public accounts: Account;
  public state: IStateData[] = [];
  private lastStateBlockId: Uint8Array = new Uint8Array();
  private chains: Chain[] = [];
  // @ts-ignore TODO: Use it for something
  private storage: Storage;

  // memory pool, may be cleared after each level is confirmed (if not serving)
  private compactBlockMap: Map<Uint8Array, ICompactBlockData> = new Map();
  private proofMap: Map<Uint8Array, IProofData> = new Map();
  private contentMap: Map<Uint8Array, IContentData> = new Map();
  private txMap: Map<Uint8Array, ITxData> = new Map();
  private unconfirmedTxs: Set<Uint8Array> = new Set(); // has not been included in a block
  private unconfirmedBlocksByChain: Array<Set<Uint8Array>> = []; // has not been included in a level
  private unconfirmedChains: Set<number> = new Set(); // does not have any new blocks since last level was confirmed

  constructor(storageAdapter: string, path: string) {
    super();
    this.storage = new Storage(storageAdapter, path);
    this.accounts = new Account();
  }

  /**
   * Creates a new genesis level.
   * Returns the initial erasure coded piece set with metadata.
   */
  public async createGenesisLevel(chainCount: number): Promise<[Uint8Array[], Uint8Array]> {

    // init the chains
    this.chainCount = chainCount;

    // init level data
    let previousProofHash = new Uint8Array();
    const parentContentHash = new Uint8Array();
    const levelRecords: Uint8Array[] = [];
    let levelProofs: Uint8Array = new Uint8Array();

    // init each chain with a genesis block
    for (let i = 0; i < this.chainCount; ++i) {
      const chain = new Chain(i);
      const block = Block.createGenesisBlock(previousProofHash, parentContentHash);
      // print(block.print());
      previousProofHash = block.value.proof.key;

      // save the proof, append to level data
      this.proofMap.set(block.value.proof.key, block.value.proof.toData());
      const binProof = block.value.proof.toBytes();
      levelRecords.push(binProof);
      levelProofs = Buffer.concat([levelProofs, binProof]);

      // save the content, append to level data
      this.contentMap.set(block.value.content.key, block.value.content.toData());
      levelRecords.push(block.value.content.toBytes());

      // extend the chain and to ledger
      chain.addBlock(block.key);
      this.chains.push(chain);

      // add compact block
      const compactBlockData: ICompactBlockData = [block.value.proof.key, block.value.content.key];
      this.compactBlockMap.set(block.key, compactBlockData);

      // init each chain as unconfirmed
      this.unconfirmedChains.add(i);
      this.unconfirmedBlocksByChain.push(new Set());
    }

    const levelHash = crypto.hash(levelProofs);
    this.parentProofHash = previousProofHash;
    return [levelRecords, levelHash];
  }

  /**
   * Creates a subsequent level once a new level is confirmed (at least one new block for each chain).
   * Returns a canonical erasure coded piece set with metadata that will be the same across all nodes.
   */
  public async createLevel(): Promise<[Uint8Array[], Uint8Array]> {
    const levelRecords: Uint8Array[] = [];
    let levelProofs: Uint8Array = new Uint8Array();
    const uniqueTxSet: Set<Uint8Array> = new Set();
    for (const chain of this.unconfirmedBlocksByChain) {
      for (const blockId of chain.values()) {
        const compactBlockData = this.compactBlockMap.get(blockId);
        if (!compactBlockData) {
          throw new Error('Cannot create new level, cannot fetch requisite compact block data');
        }

        const proofData = this.proofMap.get(compactBlockData[0]);
        const contentData = this.contentMap.get(compactBlockData[1]);
        if (!proofData || !contentData) {
          throw new Error('Cannot create new level, cannot fetch requisite proof or content data');
        }

        const proof = Proof.load(proofData);
        const binProof = proof.toBytes();
        levelRecords.push(binProof);
        levelProofs = Buffer.concat([levelProofs, binProof]);
        const content = Content.load(contentData);
        levelRecords.push(content.toBytes());

        for (const txId of content.value.payload) {
          uniqueTxSet.add(txId);
        }

        for (const txId of uniqueTxSet) {
          const txData = this.txMap.get(txId);
          if (!txData) {
            throw new Error('Cannot create new level, cannot fetch requisite transaction data');
          }
          const tx = Tx.load(txData);
          levelRecords.push(tx.toBytes());
        }
      }
      chain.clear();
    }

    const levelHash = crypto.hash(levelProofs);
    return [levelRecords, levelHash];
  }

  /**
   * Takes the source data for a level and applies padding, slices, erasure codes, and creates a piece index.
   * Compresses the encoded level into a state block.
   * Returns an erasure coded piece set with metadata.
   */
  public async encodeLevel(levelRecords: Uint8Array[], levelHash: Uint8Array): Promise<IPiece[]> {
    // prepend each record with its length
    let levelData = new Uint8Array();
    for (const record of levelRecords) {
      levelData = Buffer.concat([levelData, num2Bin(record.length), record]);
    }
    levelData = Uint8Array.from(levelData);

    let state: State;
    const pieceDataSet: IPiece[] = [];

    // encode level and generate the piece set
    const paddedLevel = codes.padLevel(levelData);
    if (paddedLevel.length <= 4096) {
      // if single piece then do not erasure code, slice, or generate index
      const pieceHash = crypto.hash(paddedLevel);

      state = State.create(
        this.lastStateBlockId,
        levelHash,
        pieceHash,
        DIFFICULTY,
        VERSION,
        new Uint8Array(),
      );

      // create the single piece metadata for this level
      const pieceData: IPiece = {
        piece: paddedLevel,
        data: {
          pieceHash,
          levelIndex: this.state.length + 1,
          pieceIndex: 0,
          proof: new Uint8Array(),
        },
      };

      pieceDataSet.push(pieceData);

    } else {
      // this level has at least two source pieces, erasure code parity shards and add index piece
      const erasureCodedLevel = await codes.erasureCodeLevel(paddedLevel);
      const pieces = codes.sliceLevel(erasureCodedLevel);

      // create the piece index
      const pieceHashes = pieces.map((piece) => crypto.hash(piece));
      const indexData: Uint8Array = Uint8Array.from(Buffer.concat([...pieceHashes]));
      const indexPiece = codes.padPiece(indexData);
      const indexPieceId = crypto.hash(indexPiece);
      pieces.push(indexPiece);
      pieceHashes.push(indexPieceId);

      // build merkle tree and create state block
      const { root, proofs } = crypto.buildMerkleTree(pieceHashes);
      const levelHash = crypto.hash([...this.proofMap.keys()]
        .reduce((sum, id) => Buffer.concat([sum, id])));

      this.previousLevelHash = levelHash;

      state = State.create(
        this.lastStateBlockId,
        levelHash,
        root,
        DIFFICULTY,
        VERSION,
        indexPieceId,
      );

      for (let i = 0; i < pieces.length; ++i) {
        pieceDataSet[i] = {
          piece: pieces[i],
          data: {
            pieceHash: pieceHashes[i],
            levelIndex: this.state.length + 1,
            pieceIndex: i,
            proof: proofs[i],
          },
        };
      }
    }

    this.state.push(state.toData());
    this.lastStateBlockId = state.key;

    if (!this.isServing) {
      // clear the pending state from memory
      this.compactBlockMap.clear();
      this.proofMap.clear();
      this.contentMap.clear();
      this.txMap.clear();
      this.chains.forEach((chain) => chain.reset());
    }

    return pieceDataSet;
  }

  /**
   * Takes any minimal subset of the erasure coded level and returns the original records (blocks, proofs, contents, and txs).
   */
  // public async decodeLevel(levelData: Uint8Array): Promise<void> {
  //   // parse record length value
  //   // parse record
  //   // load and validate all proofs
  //   // load and validate all content
  //   // load and validate all txs
  //   // ensure all txs described in content are included
  //   // reconstruct each block
  //   return;
  // }

  /**
   * Called when a new Block solution is generated locally.
   * Emits a fully formed Block for gossip by Node.
   * Passes the Block on to be applied to Ledger
   */
  public async createBlock(proof: Proof, coinbaseTx: Tx): Promise<Block> {

    // create the block
    const chainIndex = crypto.jumpHash(proof.key, this.chainCount);
    const parentBlockId = this.chains[chainIndex].head;
    const compactParentBlock = this.compactBlockMap.get(parentBlockId);
    if (!compactParentBlock) {
      throw new Error('Cannot get parent block when extending the chain.');
    }
    const parentContentHash = compactParentBlock[1];
    const txIds = [coinbaseTx.key, ...this.unconfirmedTxs.values()];
    const block = Block.create(proof, parentContentHash, txIds, coinbaseTx);

    // pass up to node for gossip across the network
    this.emit('block', block);

    await this.applyBlock(block);
    return block;
  }

  /**
   * Validates a Block against the Ledger.
   * Ensures the Proof and Content are well-formed.
   * Ensures all included Txs are valid against the Ledger and well-formed.
   */
  public async isValidBlock(block: Block, encoding: Uint8Array): Promise<boolean> {

    // validate the block, proof, content, and coinbase tx are all well formed, will throw if not
    block.isValid();

    // handle genesis blocks ...
    if (block.value.proof.value.previousLevelHash.length === 0) {

      // previous proof hash should be null or in proof map
      if (block.value.proof.value.previousProofHash.length === 0) {
        const genesisProof = this.proofMap.get(block.value.proof.key);
        if (!genesisProof || this.proofMap.size) {
          throw new Error('Invalid genesis block, already have a first genesis proof');
        }
      } else {
        // check in proof map
        const previousProofData = this.proofMap.get(block.value.proof.value.previousProofHash);
        if (!previousProofData) {
          throw new Error('Invalid genesis block, does not reference a known proof');
        }
      }

      // encoding should be null
      if (encoding.length > 0) {
        throw new Error('Invalid genesis block, should not have an attached encoding');
      }

      return true;
    }

    // verify the proof ...

    // previous level hash is last seen level
    if (block.value.proof.value.previousLevelHash.toString() !== this.previousLevelHash.toString()) {
      throw new Error('Invalid block proof, points to incorrect previous level');
    }

    // previous proof hash is in proof map
    if (!this.proofMap.has(block.value.proof.key)) {
      throw new Error('Invalid block proof, points to an unknown previous proof');
    }

    // solution is part of encoded piece
    let hasSolution = false;
    for (let i = 0; i < PIECE_SIZE / HASH_LENGTH; ++i) {
      const chunk = encoding.subarray((i * HASH_LENGTH), (i + 1) * HASH_LENGTH);
      if (chunk.toString() === block.value.proof.value.solution.toString()) {
        hasSolution = true;
        break;
      }
    }

    if (!hasSolution) {
      throw new Error('Invalid block proof, solution is not present in encoding');
    }

    // piece level is seen in state
    if (this.state.length < block.value.proof.value.pieceLevel) {
      throw new Error('Invalid block proof, referenced piece level is unknown');
    }

    // piece proof is valid for a given state level
    const pieceStateData = this.state[block.value.proof.value.pieceLevel];
    const state = State.load(pieceStateData);
    const validPieceProof = crypto.isValidMerkleProof(state.value.pieceRoot, block.value.proof.value.pieceProof, block.value.proof.value.pieceHash);
    if (!validPieceProof) {
      throw new Error('Invalid block proof, piece proof is not a valid merkle path');
    }

    const proverAddress = crypto.hash(block.value.proof.value.publicKey);
    const piece = codes.decodePiece(encoding, proverAddress);
    const pieceHash = crypto.hash(piece);
    if (pieceHash.toString() !== block.value.proof.value.pieceHash.toString()) {
      throw new Error('Invalid block proof, encoding does not decode back to parent piece');
    }

    // verify the content points to the correct chain
    const correctChainIndex = crypto.jumpHash(block.value.proof.key, this.chainCount);
    const parentContentData = this.contentMap.get(block.value.content.value.parentContentHash);
    if (!parentContentData) {
      throw new Error('Invalid block content, cannot retrieve parent content block');
    }
    const parentContent = Content.load(parentContentData);
    const parentChainIndex = crypto.jumpHash(parentContent.value.proofHash, this.chainCount);
    if (parentChainIndex !== correctChainIndex) {
      throw new Error('Invalid block content, does not hash to the same chain as parent');
    }

    // validate the coinbase tx (since not in mempool)
    if (!block.value.coinbase) {
      throw new Error('Invalid block, does not have a coinbase tx');
    }
    this.isValidTx(block.value.coinbase);

    // verify each tx in the content (including coinbase)
    const txIds = block.value.content.value.payload;
    for (let i = 1; i < txIds.length; ++i) {
      const txData = this.txMap.get(txIds[i]);
      if (!txData) {
        throw new Error('Invalid block content, cannot retrieve referenced tx id');
      }
      const tx = Tx.load(txData);
      this.isValidTx(tx);
    }

    return true;
  }

  /**
   * Called when a new valid block is received over the network or generated locally.
   * Assumes the block has been validated on receipt over the network or correctly formed locally.
   * Applies the block to ledger state.
   */
  public async applyBlock(block: Block): Promise<void> {
    return new Promise(async (resolve) => {
      // extend the correct chain with block id and add to compact block map
      const chainIndex = crypto.jumpHash(block.value.proof.key, this.chainCount);
      const chain = this.chains[chainIndex];
      chain.addBlock(block.key);
      this.compactBlockMap.set(block.key, [block.value.proof.key, block.value.content.key]);
      this.unconfirmedBlocksByChain[chainIndex].add(block.key);

      // add proof to proof map and update last proof seen
      this.proofMap.set(block.value.proof.key, block.value.proof.toData());
      this.parentProofHash = block.value.proof.key;

      // add content to content map
      this.contentMap.set(block.value.content.key, block.value.content.toData());

      if (!block.value.coinbase) {
        throw new Error('Cannot apply block without a coinbase tx');
      }

      // apply the coinbase tx (skip unconfirmed)
      const coinbase = block.value.coinbase;
      this.txMap.set(coinbase.key, coinbase.toData());
      this.applyTx(coinbase);

      // for each credit tx, apply and remove from unconfirmed set, skipping the coinbase tx
      const txIds = block.value.content.value.payload;
      for (let i = 1; i < txIds.length; ++i) {
        const txId = txIds[i];
        const txData = this.txMap.get(txId);
        if (!txData) {
          throw new Error('Cannot apply tx that is not in the mempool');
        }
        const tx = Tx.load(txData);
        this.applyTx(tx);
        this.unconfirmedTxs.delete(txId);
      }

      // tslint:disable-next-line: no-console
      console.log('Completed applying block, checking if level is confirmed');

      // update level confirmation cache and check if level is confirmed
      this.unconfirmedChains.delete(chainIndex);
      if (!this.unconfirmedChains.size) {
        const [levelRecords, levelHash] = await this.createLevel();
        this.emit('confirmed-level', levelRecords, levelHash);

        for (let i = 0; i < this.chainCount; ++i) {
          this.unconfirmedChains.add(i);
        }

        if (this.isFarming) {
          this.once('completed-plotting', () => {
            // tslint:disable-next-line: no-console
            console.log('completed plotting new piece set');
            resolve();
          });
        } else {
          resolve();
        }
      }
      resolve();
    });
  }

  /**
   * Validates a Tx against the Ledger and ensures it is well-formed.
   * Validates schema.
   * Ensures the sender has funds to cover.
   * Ensures the nonce has been incremented.
   */
  public async isValidTx(tx: Tx): Promise<boolean> {
    // validate schema, will throw if invalid
    tx.isValid();

    // does sender have funds to cover tx (if not coinbase)
    if (tx.value.sender.length > 0) {
      const senderBalance = this.accounts.get(tx.senderAddress);
      if (!senderBalance) {
        throw new Error('Invalid tx, sender has no account on the ledger!');
      }
      if (senderBalance - tx.value.amount < 0) {
        throw new Error('Invalid tx, sender does not have funds to cover the amount!');
      }
    }

    // has nonce been incremented? (prevent replay attack)
      // how to get the last tx for this account?
        // create secondary index in rocks for address and compile...
        // track the nonce in each address field in accounts

    return true;
  }

  /**
   * Called when a new valid tx is received over the network or generated locally.
   * Assumes the tx has been validated on receipt over the network or correctly formed locally.
   * Applies the tx to ledger state by adjust account balances.
   */
  public applyTx(tx: Tx): void {
      // debit the sender, if not coinbase tx
      if (tx.value.sender) {
        this.accounts.update(tx.senderAddress, -tx.value.amount);
      }

      // always credit the receiver
      this.accounts.update(tx.receiverAddress, tx.value.amount);

      // apply the fee to the farmer?
      // note when tx is referenced (added to a block)
      // note when tx is confirmed (a block referencing is captured in a level)
      // note when tx is deep confirmed (N other levels have also been confirmed, 6?)
  }
}
