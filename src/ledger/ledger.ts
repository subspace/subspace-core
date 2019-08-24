// tslint:disable: max-classes-per-file
// tslint:disable: object-literal-sort-keys

import { EventEmitter } from 'events';
import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { DIFFICULTY, VERSION } from '../main/constants'
import {IBlockData, IBlockValue, ICompactBlockData, ICompactBlockValue, IContentData, IPiece, IProofData, IStateData, ITxData} from '../main/interfaces';
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
  // check if level is confirmed
    // update state and solve
    // encode the new level
    // update the piece set and plot
  // handle chain forks
  // handle level forks
  // Refactor Level into a separate class
  // handle tx fees
  // handle validation where one farmer computes the next level and adds pieces before another

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
// need to define the RPC layer
// how do we load balance the RPC requests across the network



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
  public state: Map<Uint8Array, IStateData> = new Map();
  private lastStateBlockId: Uint8Array = new Uint8Array();
  private chains: Chain[] = [];
  private storage: Storage;

  // memory pool, may be cleared after each level is confirmed (if not serving)
  private compactBlockMap: Map<Uint8Array, ICompactBlockData> = new Map();
  private proofMap: Map<Uint8Array, IProofData> = new Map();
  private contentMap: Map<Uint8Array, IContentData> = new Map();
  private txMap: Map<Uint8Array, ITxData> = new Map();
  private unconfirmedTxs: Set<Uint8Array> = new Set(); // has not been included in a block
  private unconfirmedBlocksByChain: Set<Uint8Array>[] = []; // has not been included in a level
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
  public async createGenesisLevel(chainCount: number): Promise<IPiece[]> {

    // init the chains
    this.chainCount = chainCount;

    // init level data
    let previousProofHash = new Uint8Array();
    const parentContentHash = new Uint8Array();
    const levelRecords: Uint8Array[] = [];

    // init each chain with a genesis block
    for (let i = 0; i < this.chainCount; ++i) {
      const chain = new Chain(i);
      const block = Block.createGenesisBlock(previousProofHash, parentContentHash);
      previousProofHash = block.value.proof.key;

      // save the proof, append to level data
      this.proofMap.set(block.value.proof.key, block.value.proof.toData());
      levelRecords.push(block.value.proof.toBytes());

      // save the content, append to level data
      this.contentMap.set(block.value.content.key, block.value.content.toData());
      levelRecords.push(block.value.content.toBytes());

      // extend the chain and to ledger
      chain.addBlock(block.key);
      this.chains.push(chain);

      // init each chain as unconfirmed
      this.unconfirmedChains.add(i);
      this.unconfirmedBlocksByChain.push(new Set());
    }

    this.parentProofHash = previousProofHash;

    // encode the level
    return this.encodeLevel(levelRecords);
  }

  /**
   * Creates a subsequent level once a new level is confirmed (at least one new block for each chain).
   * Returns a canonical erasure coded piece set with metadata that will be the same across all nodes.
   */
  public async createLevel(): Promise<IPiece[]> {
    const levelRecords: Uint8Array[] = [];
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
        levelRecords.push(proof.toBytes());
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

    return this.encodeLevel(levelRecords);
  }

  /**
   * Takes the source data for a level and applies padding, slices, erasure codes, and creates a piece index.
   * Compresses the encoded level into a state block.
   * Returns an erasure coded piece set with metadata.
   */
  public async encodeLevel(levelRecords: Uint8Array[]): Promise<IPiece[]> {
    // prepend each record with its length
    let levelData = new Uint8Array();
    for (const record of levelRecords) {
      levelData = Buffer.concat([num2Bin(record.length), record]);
    }

    // encode level and generate the piece set
    const paddedLevel = codes.padLevel(levelData);
    const erasureCodedLevel = await codes.erasureCodeLevel(paddedLevel);
    const pieces = codes.sliceLevel(erasureCodedLevel);

    // create the piece index
    const pieceHashes = pieces.map((piece) => crypto.hash(piece));
    const indexData: Uint8Array = Buffer.concat([...pieceHashes]);
    const indexPiece = codes.padPiece(indexData);
    const indexPieceId = crypto.hash(indexPiece);
    pieces.push(indexPiece);
    pieceHashes.push(indexPieceId);

    // build merkle tree and create state block
    const { root, proofs } = crypto.buildMerkleTree(pieceHashes);
    const levelHash = crypto.hash([...this.proofMap.keys()]
      .reduce((sum, id) => Buffer.concat([sum, id])));

    this.previousLevelHash = levelHash;

    const state = State.create(
      this.lastStateBlockId,
      levelHash,
      root,
      DIFFICULTY,
      VERSION,
      indexPieceId,
    );

    this.state.set(state.key, state.toData());
    this.lastStateBlockId = state.key;
    const stateIndex = this.state.size;

    // compile the piece data set for plotting
    const pieceDataSet: IPiece[] = [];
    for (let i = 0; i < pieces.length; ++i) {
      pieceDataSet[i] = {
        piece: pieces[i],
        data: {
          pieceHash: pieceHashes[i],
          levelIndex: stateIndex,
          pieceIndex: i,
          proof: proofs[i],
        },
      };
    }

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
  public async decodeLevel(leveData: Uint8Array): Promise<void> {
    // parse record length value
    // parse record
    // load and validate all proofs
    // load and validate all content
    // load and validate all txs
    // ensure all txs described in content are included
    // reconstruct each block
    return;
  }

  /**
   * Called when a new Block solution is generated locally.
   * Emits a fully formed Block for gossip by Node.
   * Passes the Block on to be applied to Ledger
   */
  public async createBlock(proof: Proof, coinbaseTx: Tx): Promise<void> {

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
    return;
  }

  /**
   * Validates a Block against the Ledger.
   * Ensures the Proof and Content are well-formed.
   * Ensures all included Txs are valid against the Ledger and well-formed.
   */
  public async isValidBlock(block: Block): Promise<boolean> {
    let isValid = true;
    // validate the proof
    // validate the content
    // validate the coinbase tx
    // validate each credit tx
      // if not in the mempool fail
    if (block.isValid()) {
      isValid = false;
    }
    return isValid;
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

      // update level confirmation cache and check if level is confirmed
      this.unconfirmedChains.delete(chainIndex);
      if (!this.unconfirmedChains.size) {
        const pieceDataSet = await this.createLevel();
        this.emit('confirmed-level', pieceDataSet);

        for (let i = 0; i < this.chainCount; ++i) {
          this.unconfirmedChains.add(i);
        }

        if (this.isFarming) {
          this.on('completed-plotting', () => {
            resolve();
          });
        } else {
          resolve();
        }
      }
    });
  }

  /**
   * Validates a Tx against the Ledger and ensures it is well-formed.
   */
  public async isValidTx(tx: Tx): Promise<boolean> {
    let isValid = true;
    if (tx.isValid()) {
      isValid = false;
    }
    return isValid;
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
