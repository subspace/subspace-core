// tslint:disable: max-classes-per-file
// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console
// tslint:disable: member-ordering

import { ArrayMap, ArraySet } from "array-map-set";
import { EventEmitter } from 'events';
import * as codes from '../codes/codes';
import {BlsSignatures} from "../crypto/BlsSignatures";
import * as crypto from '../crypto/crypto';
import { CHUNK_LENGTH, PIECE_SIZE } from '../main/constants';
import { IFullBlockValue, IPiece} from '../main/interfaces';
import { Storage } from '../storage/storage';
import { areArraysEqual, bin2Hex, ILogger, print, smallNum2Bin } from '../utils/utils';
import { Account } from './accounts';
import { Block } from './block';
import { Chain } from './chain';
import { Content } from './content';
import { Proof } from './proof';
import { State } from './state';
import { Tx } from './tx';

// ToDo
  // handle validation where one farmer computes the next level and adds pieces before another
  // handle chain forks
  // handle level forks
  // set minimum work difficulty
  // work difficulty resets
  // fix memory leak
  // run in farmer mode, pruning chain state after each new level
  // decode levels
  // Refactor Level into a separate class
  // handle tx fees
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

  public readonly encodingRounds: number;
  public isFarming = true;
  public isServing = true;
  public isValidating: boolean;

  private previousStateHash = new Uint8Array(32);
  public previousLevelHash = new Uint8Array(32);
  public parentProofHash = new Uint8Array(32);
  public previousBlockHash = new Uint8Array(32);

  // persistent state
  public chainCount = 0;
  public confirmedTxs = 0;
  public confirmedBlocks = 0;
  public confirmedLevels = 0;
  public confirmedState = 0;
  public lastCoinbaseTxTime = 0;
  public genesisLevelChainIndex = 0;

  public accounts: Account;
  public stateMap = ArrayMap<Uint8Array, Uint8Array>();

  // memory pool, may be cleared after each level is confirmed (if not serving)
  public compactBlockMap = ArrayMap<Uint8Array, Uint8Array>();
  private chains: Chain[] = [];
  private readonly blsSignatures: BlsSignatures;
  private storage: Storage;
  public proofMap = ArrayMap<Uint8Array, Uint8Array>();
  private contentMap = ArrayMap<Uint8Array, Uint8Array>();
  private txMap = ArrayMap<Uint8Array, Uint8Array>();
  private unconfirmedTxs: Set<Uint8Array> = ArraySet(); // has not been included in a block
  private unconfirmedBlocksByChain: Array<Set<Uint8Array>> = []; // has not been included in a level
  private unconfirmedChains: Set<number> = new Set(); // does not have any new blocks since last level was confirmed
  public earlyBlocks = ArrayMap<Uint8Array, IFullBlockValue>();
  public blockIndex: Map<number, Uint8Array> = new Map();
  public stateIndex: Map<number, Uint8Array> = new Map();
  private pendingState: Uint8Array = new Uint8Array();
  public readonly logger: ILogger;

  constructor(
    blsSignatures: BlsSignatures,
    storage: Storage,
    chainCount: number,
    trustRecords: boolean,
    encodingRounds: number,
    parentLogger: ILogger,
  ) {
    super();
    this.blsSignatures = blsSignatures;
    this.logger = parentLogger.child({subsystem: 'ledger'});
    this.storage = storage;
    this.accounts = new Account();
    this.isValidating = !trustRecords;
    this.encodingRounds = encodingRounds;

    // initialize chains
    this.chainCount = chainCount;
    for (let i = 0; i < this.chainCount; ++i) {
      // create each chain
      const chain = new Chain(i);
      this.chains.push(chain);

      // init each chain as unconfirmed
      this.unconfirmedBlocksByChain.push(ArraySet());
      this.unconfirmedChains.add(i);
    }
  }

  /**
   * Create the genesis state to use as the source data for starting piece set.
   *
   * @return the genesis piece set for plotting in the farm
   */
  public async createGenesisState(): Promise<IPiece[]> {
    const sourceData = crypto.randomBytes(127 * 4096);
    const { state, pieceDataSet } = await codes.encodeState(sourceData, this.previousStateHash, Date.now());
    this.stateMap.set(state.key, state.toBytes());
    this.previousStateHash = state.key;
    return pieceDataSet;
  }

  /**
   * Called by Node when a new solution is found to the block challenge.
   *
   * @param proof the canonical proof of unique storage
   * @param coinbaseTx the associatec coinbase tx
   *
   * @return the fully formed Block for Node to validate, gossip, and apply to the ledger
   */
  public async createBlock(proof: Proof, coinbaseTx: Tx): Promise<Block> {
    const chainIndex = crypto.jumpHash(proof.key, this.chainCount);
    const parentBlockId = this.chains[chainIndex].head;
    let parentContentHash: Uint8Array;

    // genesis block will not have a parent block id for that chain
    if (parentBlockId.length === 32) {
      // default case
        // a new block, not on the genesis level, or a new block on the genesis level that is not the first block on a chain
        // there should be a valid previous block that resides in the compact block map
      const compactParentBlockData = this.compactBlockMap.get(parentBlockId);
      if (!compactParentBlockData) {
        this.logger.error('Cannot get parent block when extending the chain.');
        throw new Error('Cannot get parent block when extending the chain.');
      }
      const compactParentBlock = Block.fromCompactBytes(compactParentBlockData);
      parentContentHash = compactParentBlock.contentHash;
    } else if (areArraysEqual(proof.value.previousLevelHash, new Uint8Array(32)) && !areArraysEqual(proof.value.previousProofHash, new Uint8Array(32))) {
      // corner case 1
        // a new block on the genesis level, that is the first block of a chain, but not the first block in the ledger,
        // previosProofHash should not be null
        // previousLevelhash should be null
      parentContentHash = new Uint8Array(32);
    } else {
      // corner case 2:
        // the first block in the ledger
        // previousProofHash should be null
        // previousLevelhash shsould be null
      if (!areArraysEqual(proof.value.previousProofHash, new Uint8Array(32)) || !areArraysEqual(proof.value.previousProofHash, new Uint8Array(32))) {
        this.logger.error('Only the genesis block may have a null parent proof hash and previousLevelHash');
        throw new Error('Only the genesis block may have a null parent proof hash');
      }
      parentContentHash = new Uint8Array(32);
    }

    const txIds = [coinbaseTx.key, ...this.unconfirmedTxs.values()];
    const block = Block.create(this.previousBlockHash, proof, parentContentHash, txIds, coinbaseTx);
    this.logger.verbose(`Created new block ${bin2Hex(block.key).substring(0, 16)} for chain ${chainIndex}`);
    return block;
  }

  /**
   * Validates a block and its contents (proof, content, txs) are valid against the given encoding and the current ledger state.
   *
   * @param block the fully formed block (proof, content, coinbase tx)
   * @param encoding the encoding associated with the proof
   *
   * @return whether or not the block is valid (boolean)
   */
  public async isValidBlock(block: Block, encoding: Uint8Array): Promise<boolean> {

    // validate the block, proof, content, and coinbase tx are all well formed, will throw if not
    block.isValid(this.blsSignatures);

    // verify the proof

    // previous level hash is last seen level
    if (!areArraysEqual(block.value.proof.value.previousLevelHash, this.previousLevelHash)) {
      print(block.print());
      this.logger.verbose('Last seen level', this.previousLevelHash);
      this.logger.error('Invalid block proof, points to incorrect previous level');
      throw new Error('Invalid block proof, points to incorrect previous level');
    }

    // previous proof hash is in proof map
    if (!this.proofMap.has(block.value.proof.value.previousProofHash)) {
      if (!areArraysEqual(block.value.proof.value.previousProofHash, new Uint8Array(32)) || !areArraysEqual(block.value.proof.value.previousProofHash, new Uint8Array(32))) {
        this.logger.error('Invalid block proof, points to an unknown previous proof');
        throw new Error('Invalid block proof, points to an unknown previous proof');
      }
    }

    // solution is part of encoded piece
    let hasSolution = false;
    for (let i = 0; i < PIECE_SIZE / CHUNK_LENGTH; ++i) {
      const chunk = encoding.subarray((i * CHUNK_LENGTH), (i + 1) * CHUNK_LENGTH);
      if (areArraysEqual(chunk, block.value.proof.value.solution)) {
        hasSolution = true;
        break;
      }
    }

    if (!hasSolution) {
      this.logger.error('Invalid block proof, solution is not present in encoding');
      throw new Error('Invalid block proof, solution is not present in encoding');
    }

    // piece level is seen in state
    if (!this.stateMap.has(block.value.proof.value.pieceStateHash) && areArraysEqual(block.value.proof.value.pieceStateHash, new Uint8Array(32))) {
      this.logger.error('Invalid block proof, referenced piece level is unknown');
      throw new Error('Invalid block proof, referenced piece level is unknown');
    }

    // piece proof is valid for a given state level, assuming their is more than one piece in the level
    if (!areArraysEqual(block.value.proof.value.previousLevelHash, block.value.proof.value.previousProofHash)) {
      const pieceStateData = this.stateMap.get(block.value.proof.value.pieceStateHash);
      if (!pieceStateData) {
        this.logger.verbose('state keys are: ', this.stateMap.keys());
        this.logger.verbose('missing state is', block.value.proof.value.pieceStateHash);
        this.logger.error('Invalid block proof, referenced state data is not in state map');
        throw new Error('Invalid block proof, referenced state data is not in state map');
      }
      const state = State.fromBytes(pieceStateData);
      const validPieceProof = crypto.isValidMerkleProof(state.value.pieceRoot, block.value.proof.value.pieceProof, block.value.proof.value.pieceHash);
      if (!validPieceProof) {
        this.logger.error('Invalid block proof, piece proof is not a valid merkle path');
        throw new Error('Invalid block proof, piece proof is not a valid merkle path');
      }
    }

    // encoding decodes pack to piece
    const proverAddress = crypto.hash(block.value.proof.value.publicKey);
    const piece = codes.decodePiece(encoding, proverAddress, this.encodingRounds);
    const pieceHash = crypto.hash(piece);
    if (!areArraysEqual(pieceHash, block.value.proof.value.pieceHash)) {
      this.logger.error('Invalid block proof, encoding does not decode back to parent piece');
      throw new Error('Invalid block proof, encoding does not decode back to parent piece');
    }

    // check that the parent content hash is on the correct chain
    // if the block is a genesis block for a chain, the parent content hash will be null
    // if the block is normal, then its parent block should be within the compact block map

    const correctChainIndex = crypto.jumpHash(block.value.proof.key, this.chainCount);

    if (areArraysEqual(block.value.content.value.parentContentHash, new Uint8Array(32))) {
      // this should be the first block for a chain
      if (!areArraysEqual(block.value.proof.value.previousLevelHash, new Uint8Array(32))) {
        throw new Error('Invalid block, can only have a null parent content on the genesis level');
      }

      const chain = this.chains[correctChainIndex];
      if (chain.height !== 0) {
        throw new Error('Invalid block, content claims to start a chain that already has a genesis block');
      }
    } else {
      const parentContentData = await this.getContent(block.value.content.value.parentContentHash);
      if (!parentContentData) {
        this.logger.error('Invalid block content, cannot retrieve parent content block');
        throw new Error('Invalid block content, cannot retrieve parent content block');
      }

      const parentContent = Content.fromBytes(parentContentData);
      const parentChainIndex = crypto.jumpHash(parentContent.value.proofHash, this.chainCount);
      if (parentChainIndex !== correctChainIndex) {
        throw new Error('Invalid block content, does not hash to the same chain as parent');
      }
    }

    // validate the coinbase tx (since not in mempool)
    if (!block.value.coinbase) {
      this.logger.error('Invalid block, does not have a coinbase tx');
      throw new Error('Invalid block, does not have a coinbase tx');
    }
    this.isValidTx(block.value.coinbase);

    // verify each tx in the content (including coinbase)
    const txIds = block.value.content.value.payload;
    for (let i = 1; i < txIds.length; ++i) {
      const txData = this.txMap.get(txIds[i]);
      if (!txData) {
        this.logger.error('Invalid block content, cannot retrieve referenced tx id');
        throw new Error('Invalid block content, cannot retrieve referenced tx id');
      }
      const tx = Tx.fromBytes(txData);
      this.isValidTx(tx);
    }

    return true;
  }

  /**
   * Checks if a new tx is valid against the current ledger and that it is internally consistent.
   *
   * @param tx the tx instance to be validated
   *
   * @return whether or not the tx is valid (boolean)
   */
  public async isValidTx(tx: Tx): Promise<boolean> {
    // validate schema, will throw if invalid
    tx.isValid(this.blsSignatures);

    // does sender have funds to cover tx (if not coinbase)
    if (!areArraysEqual(tx.value.sender, new Uint8Array(48))) {
      const senderBalance = this.accounts.get(tx.senderAddress);
      if (!senderBalance) {
        this.logger.error('Invalid tx, sender has no account on the ledger!');
        throw new Error('Invalid tx, sender has no account on the ledger!');
      }
      if (senderBalance - tx.value.amount < 0) {
        this.logger.error('Invalid tx, sender does not have funds to cover this amount!');
        throw new Error('Invalid tx, sender does not have funds to cover the amount!');
      }
    }

    // has nonce been incremented? (prevent replay attack)
      // how to get the last tx for this account?
        // create secondary index in rocks for address and compile...
        // track the nonce in each address field in accounts

    this.logger.verbose(`Validated new ${areArraysEqual(tx.value.sender, new Uint8Array(48)) ? "credit" : "coinbase"} tx ${bin2Hex(tx.key).substring(0, 16)}`);
    return true;
  }

  /**
   * Called when a new valid block has been created locally or received over th network.
   * Applies the block to the ledger, checks if the leve is confirmed, and if state can be encoded.
   *
   * @param block the fully formed block instance to be applied
   */
  public async applyBlock(block: Block): Promise<void> {
    // extend the correct chain with block id and add to compact block map
    const chainIndex = crypto.jumpHash(block.value.proof.key, this.chainCount);
    this.blockIndex.set(this.blockIndex.size, block.key);
    this.chains[chainIndex].addBlock(block.key);
    this.compactBlockMap.set(block.key, block.toCompactBytes());
    this.unconfirmedBlocksByChain[chainIndex].add(block.key);
    this.previousBlockHash = block.key;

    // add proof to proof map and update last proof seen
    this.proofMap.set(block.value.proof.key, block.value.proof.toBytes());
    this.parentProofHash = block.value.proof.key;

    // add content to content map
    this.contentMap.set(block.value.content.key, block.value.content.toBytes());

    const coinbase = block.value.coinbase;
    this.txMap.set(coinbase.key, coinbase.toBytes());
    this.applyTx(coinbase);
    this.lastCoinbaseTxTime = block.value.coinbase.value.timestamp;

    // for each credit tx, apply and remove from unconfirmed set, skipping the coinbase tx
    const txIds = block.value.content.value.payload;
    for (let i = 1; i < txIds.length; ++i) {
      const txId = txIds[i];
      const txData = this.txMap.get(txId);
      if (!txData) {
        this.logger.error('Cannot apply tx that is not in the mempool');
        throw new Error('Cannot apply tx that is not in the mempool');
      }
      const tx = Tx.fromBytes(txData);
      this.applyTx(tx);
      this.unconfirmedTxs.delete(txId);
    }
    this.logger.verbose('Completed applying new block, checking if pending level has been confirmed...');

    // update level confirmation cache and check if level is confirmed
    this.unconfirmedChains.delete(chainIndex);
    this.logger.verbose(`${this.unconfirmedChains.size} unconfirmed chains remain`);
    if (!this.unconfirmedChains.size) {
      this.createLevel();
      this.logger.verbose('New level has been confirmed');
      this.logger.verbose('Chain lengths: ');
      this.logger.verbose('---------------');
      for (const chain of this.chains) {
        this.logger.verbose(`Chain ${chain.index}: ${chain.size}`);
      }

      // reset each chain back to unconfirmed
      for (let i = 0; i < this.chainCount; ++i) {
        this.unconfirmedChains.add(i);
      }

      // encode new state as needed
      while (this.pendingState.length >= (4096 * 127)) {
        await this.createState();
      }
    }
  }

  /**
   * Called when a new valid tx has been created locally or received over the network.
   * Applies the tx to the ledger and updates balances.
   *
   * @param tx the tx instance to be applied
   */
  public applyTx(tx: Tx): void {
    // debit the sender, if not coinbase tx
    if (!areArraysEqual(tx.value.sender, new Uint8Array(48))) {
      this.accounts.update(tx.senderAddress, -tx.value.amount);
    }

    // always credit the receiver
    this.accounts.update(tx.receiverAddress, tx.value.amount);
    this.logger.verbose(`Applied new ${areArraysEqual(tx.value.sender, new Uint8Array(48)) ? "credit" : "coinbase"} tx ${bin2Hex(tx.key).substring(0, 16)} to ledger.`);

    // apply the fee to the farmer?
    // note when tx is referenced (added to a block)
    // note when tx is confirmed (a block referencing is captured in a level)
    // note when tx is deep confirmed (N other levels have also been confirmed, 6?)
}

  /**
   * Organizes all blocks for a newly confirmed level by ordering the proofs and contents, then deduplicating the txs.
   * All data is written to a length encoded buffer. Once the buffer reaches a minimum size, a new state block will be encoded.
   */
  private createLevel(): void {
    const levelRecords: Uint8Array[] = [];
    const levelProofHashes: Uint8Array[] = [];
    const uniqueTxSet: Set<Uint8Array> = new Set();

    // pull each valid pending block from eachc hain
    for (const chain of this.unconfirmedBlocksByChain) {
      for (const blockId of chain.values()) {
        this.confirmedBlocks ++;

        // retrieve the block data
        const compactBlockData = this.compactBlockMap.get(blockId);
        if (!compactBlockData) {
          this.logger.error('Cannot create level, cannot retrieve required compact block data');
          throw new Error('Cannot create level, cannot retrieve required compact block data');
        }
        const compactBlock = Block.fromCompactBytes(compactBlockData);
        const proofData = this.proofMap.get(compactBlock.proofHash);
        const contentData = this.contentMap.get(compactBlock.contentHash);
        if (!proofData || !contentData) {
          this.logger.error('Cannot create new level, cannot fetch requisite proof or content data');
          throw new Error('Cannot create new level, cannot fetch requisite proof or content data');
        }

        // compile the level data and record the length of each record
        levelRecords.push(smallNum2Bin(proofData.length));
        levelRecords.push(proofData);
        levelProofHashes.push(compactBlock.proofHash);
        const content = Content.fromBytes(contentData);
        levelRecords.push(smallNum2Bin(contentData.length));
        levelRecords.push(contentData);

        for (const txId of content.value.payload) {
          uniqueTxSet.add(txId);
        }
      }
      chain.clear();
    }

    const confirmedTxs: Tx[] = [];

    for (const txId of uniqueTxSet) {
      this.confirmedTxs ++;
      const txData = this.txMap.get(txId);
      if (!txData) {
        this.logger.error('Cannot create new level, cannot fetch requisite transaction data');
        throw new Error('Cannot create new level, cannot fetch requisite transaction data');
      }
      const tx = Tx.fromBytes(txData);
      confirmedTxs.push(tx);
      levelRecords.push(smallNum2Bin(txData.length));
      levelRecords.push(txData);
    }

    // compile the level hash and update for new solving
    const levelProofHashesData = Buffer.concat(levelProofHashes);
    const levelHash = crypto.hash(levelProofHashesData);
    this.previousLevelHash = levelHash;

    // add new level data to pending state buffer
    const levelData = Buffer.concat(levelRecords);
    this.pendingState = Buffer.concat([this.pendingState, levelData]);

    // clear the pending state from memory
    // optionally save the pending state to disk
    // ideally only after state has been confirmed, or multiple levels
    if (!this.isServing) {
      this.compactBlockMap.clear();
      this.proofMap.clear();
      this.contentMap.clear();
      this.txMap.clear();
      this.chains.forEach((chain) => chain.reset());
    }

    // return the confirmed tx for wallet to parse
    this.confirmedLevels ++;
    this.emit('confirmed-level', confirmedTxs);
  }

  /**
   * Encodes pending state (confirmed level data) into a new state block for the state chain and a new canonical piece set.
   * New state is always exactly 256 pieces or 256 x 4096 bytes
   * 127 source pieces (confirmed level data)
   * 1 source index piece
   * 127 parity pieces (erasure coded level data)
   * 1 parity index piece
   * Any node can reconstruct the state using just the state block by querying the DHT for the two index pieces and retrieving any combination of 127 source and parity pieces.
   */
  private async createState(): Promise<void> {
    return new Promise(async (resolve) => {
      // we need to only take the first 127 pieces
      const levelData = this.pendingState.subarray(0, 4096 * 127);

      // assign the remainder back to the pending state
      this.pendingState = this.pendingState.subarray(4096 * 127);

      // erasure code the source state
      const { state, pieceDataSet } = await codes.encodeState(levelData, this.previousStateHash, Date.now());

      // update the state chain
      this.stateMap.set(state.key, state.toBytes());
      this.previousStateHash = state.key;
      this.confirmedState ++;

      // emit confirmed state for plotting
      this.emit('confirmed-state', state.key, pieceDataSet);

      // resolve once plotting has completed
      this.once('completed-plotting', (statehash: Uint8Array) => {
        if (areArraysEqual(state.key, statehash)) {
          resolve();
        }
      });
    });
  }

  /**
   * Searches memory and disk for a tx matching query.
   *
   * @param txId hash of tx data
   *
   * @return binary tx data or not found
   */
  public async getTx(txId: Uint8Array): Promise<Uint8Array | null | undefined> {
    let txData: Uint8Array | undefined | null;
    txData = this.txMap.get(txId);

    if (!txData) {
      txData = await this.storage.get(txId);
    }

    if (!txData) {
      this.logger.debug('Unable to get tx from memory or disk');
    }

    return txData;
  }

  /**
   * Searches memory and disk for block metadata matching query.
   *
   * @param blockId hash of block data
   *
   * @return binary block metadata or not found
   */
  public async getCompactBlock(blockId: Uint8Array): Promise<Uint8Array | null | undefined> {
    let blockData: Uint8Array | undefined | null;
    blockData = this.compactBlockMap.get(blockId);

    if (!blockData) {
      blockData = await this.storage.get(blockId);
    }

    if (!blockData) {
      this.logger.debug('Cannot get compact block from memory or disk');
    }

    return blockData;
  }

  /**
   * Searches memory and disk for a proof matching query.
   *
   * @param proofId hash of proof data
   *
   * @return binary proof data or not found
   */
  public async getProof(proofId: Uint8Array): Promise<Uint8Array | null | undefined> {
    let proofData: Uint8Array | undefined | null;
    proofData = this.proofMap.get(proofId);

    if (!proofData) {
      proofData = await this.storage.get(proofId);
    }

    if (!proofData) {
      this.logger.debug('Unable to get proof from memory or disk');
    }

    return proofData;
  }

  /**
   * Searches memory and disk for a content record matching query.
   *
   * @param contentId   hash of content data
   *
   * @return binary content data or not found
   */
  public async getContent(contentId: Uint8Array): Promise<Uint8Array | null | undefined> {
    let contentData: Uint8Array | undefined | null;
    contentData = this.contentMap.get(contentId);

    if (!contentData) {
      contentData = await this.storage.get(contentId);
    }

    if (!contentData) {
      this.logger.debug('Unable to get content from memory or disk');
    }

    return contentData;
  }

  /**
   * Searches memory and disk for a block matching query. Returns full block with proof, content, and all txs.
   *
   * @param blockId hash of block data
   *
   * @return binary block data or not found
   */
  public async getBlock(blockId: Uint8Array): Promise<Uint8Array | null | undefined> {
    let compactBlockData: Uint8Array | undefined | null;
    compactBlockData = this.compactBlockMap.get(blockId);
    if (!compactBlockData) {
      compactBlockData = await this.storage.get(blockId);
    }

    if (!compactBlockData) {
      this.logger.debug('Cannot get block, unable to get compact block data');
      return;
    }

    const compactBlock = Block.fromCompactBytes(compactBlockData);
    const proofData = await this.getProof(compactBlock.proofHash);

    if (!proofData) {
      this.logger.debug('Cannot get block, unable to get proof data');
      return;
    }

    const contentData = await this.getContent(compactBlock.contentHash);

    if (!contentData) {
      this.logger.debug('Cannot get block, unable to get content data');
      return;
    }

    const content = Content.fromBytes(contentData);
    const proof = Proof.fromBytes(proofData);
    const coinbaseData = await this.getTx(content.value.payload[0]);
    if (!coinbaseData) {
      this.logger.debug('Cannot get block, unable to get coinbase data');
      return;
    }
    const coinbase = Tx.fromBytes(coinbaseData);

    const block = new Block({
      previousBlockHash: compactBlock.previousBlockHash,
      proof,
      content,
      coinbase,
    });

    if (!areArraysEqual(block.key, blockId)) {
      this.logger.error('Cannot get block, retrieved block hash does not match request id');
      throw new Error('Error retrieving block, hash does not match request id');
    }

    return block.toFullBytes();
  }

  /**
   * Searches memory and disk for a state block matching query.
   *
   * @param stateId hash of state data
   *
   * @return binary state data or not found
   */
  public async getState(stateId: Uint8Array): Promise<Uint8Array | null | undefined> {
    let stateData: Uint8Array | undefined | null;
    stateData = this.stateMap.get(stateId);

    if (!stateData) {
      stateData = await this.storage.get(stateId);
    }

    if (!stateData) {
      this.logger.debug('Cannot get state from memory or disk');
    }

    return stateData;
  }

  /**
   * Returns the block record for a given index in the ledger.
   *
   * @param index the sequence in which the block  appears in the ledger
   *
   * @return a valid block record or null if not found
   */
  public async getBlockByIndex(index: number): Promise <Uint8Array | null | undefined> {
    const blockId = this.blockIndex.get(index);
    if (blockId) {
      return this.getBlock(blockId);
    }
    this.logger.debug('Cannot get block by index, no block id for this index');
    return;
  }

  /**
   * Returns the state record for a given index in the state chain.
   *
   * @param index the sequence in which the state block appears in the state chain
   *
   * @return a valid state record or null if not found
   */
  public async getStateByIndex(index: number): Promise <Uint8Array | null | undefined> {
    const stateId = this.stateIndex.get(index);
    if (stateId) {
      return this.getState(stateId);
    }
    this.logger.debug('Cannot get state by index, no state id for this index');
    return;
  }
}
