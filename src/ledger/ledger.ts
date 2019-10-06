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
import { areArraysEqual, bin2Hex, ILogger, measureProximity, smallNum2Bin, sortSet } from '../utils/utils';
import { Account } from './accounts';
import { Block } from './block';
import { Chain } from './chain';
import { Content } from './content';
import { Proof } from './proof';
import { State } from './state';
import { Tx } from './tx';

// Next Steps
  // handle a fork on one chain
  // create a new data structure that is the chain graph for audit puposes -- probably some kind of tree
  // fix logging in node s.t. it is intelligeble
  // then we can add in notion of piece proximity, chunk quality and audit scope
  // then we can make the chunk quality and make audit scope dynamic and self-adjusting
  // handle validation failures where one farmer computes the next level and adds pieces before another
  // fix memory leak
  // run in farmer mode, pruning chain state after each new level
  // decode levels and refactor level into a separate class
  // handle tx fees
  // enforce a maximum block size of 4096 bytes
  // check that nonce has been incremented to prevent replay attacks

export class Ledger extends EventEmitter {

  public readonly encodingRounds: number;
  public isFarming = true;
  public isServing = true;
  public isValidating: boolean;

  private previousStateHash = new Uint8Array(32);
  public parentProofHash = new Uint8Array(32);
  public previousBlockHash = new Uint8Array(32);

  // persistent state
  public chainCount = 0;
  public confirmedTxs = 0;
  public confirmedBlocks = 0;
  public confirmedState = 0;

  public accounts: Account;
  public stateMap = ArrayMap<Uint8Array, Uint8Array>();

  // memory pool, may be cleared after each level is confirmed (if not serving)
  public compactBlockMap = ArrayMap<Uint8Array, Uint8Array>();
  private chains: Chain[] = [];
  private readonly blsSignatures: BlsSignatures;
  private storage: Storage;
  private proofMap = ArrayMap<Uint8Array, Uint8Array>();
  private contentMap = ArrayMap<Uint8Array, Uint8Array>();
  // private pendingTxSet: Set<Uint8Array> = ArraySet();
  private txMap = ArrayMap<Uint8Array, Uint8Array>();
  private unconfirmedTxs: Set<Uint8Array> = ArraySet(); // has not been included in a block
  private unencodedTxs: Set<Uint8Array> = ArraySet(); // have been applied to the ledger but not encoded as state
  public earlyBlocks = ArrayMap<Uint8Array, IFullBlockValue>();
  public blockIndex: Map<number, Uint8Array> = new Map();
  public stateIndex: Map<number, Uint8Array> = new Map();
  private pendingState: Uint8Array = new Uint8Array();
  public pendingRecordsLength = 0;
  private logger: ILogger;

  // An array of chains, each chain contains a set of unconfirmed block ids for this chain
  private pendingBlocksByChain: Array<Set<Uint8Array>> = [];
  // An Array of levels (block heights), each level contains a map of key (blockId) -> value (number of chains pending confirmation)
  private pendingBlocksByLevel: Map<number, Map<Uint8Array, number>> = new Map();
  // A lookup table that maps the blockId for a pending block to which level index it sits at
  private levelForPendingBlock: Map<Uint8Array, number> = ArrayMap<Uint8Array, number>();
  // A lookup table that maps txId to a set of all valid blockIds that have claimed that tx
  // private blocksClaimingTx: Map<Uint8Array, Set<Uint8Array>> = ArrayMap<Uint8Array, Set<Uint8Array>>();

  private proof2BlockMap: Map<Uint8Array, Uint8Array> = ArrayMap<Uint8Array, Uint8Array>();
  private content2BlockMap: Map<Uint8Array, Uint8Array> = ArrayMap<Uint8Array, Uint8Array>();

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

      // create empty pending blocks tracker
      const pendingBlocksForChain: Set<Uint8Array> = ArraySet();
      this.pendingBlocksByChain.push(pendingBlocksForChain);
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
   * @return the fully formed Block for Node to validate, gossip, and apply to the ledger -- or a null response if proof is too late for chain
   */
  public async createBlock(proof: Proof, coinbaseTx: Tx): Promise<Block | void> {
    const chainIndex = crypto.jumpHash(proof.key, this.chainCount);
    const parentBlockId = this.chains[chainIndex].head;
    let parentContentHash: Uint8Array;

    // for a single chain, we have to confirm the new block as soon as it's received

    if (parentBlockId.length === 32) {
      // default case (not a genesis block)

      // get the last block on the chain we are extending (parent block)
      const parentBlockData = await this.getBlock(parentBlockId);

      if (!parentBlockData) {
        this.logger.error('Cannot get parent block when extending the chain.');
        throw new Error('Cannot get parent block when extending the chain.');
      }

      // compile the parent block and get parent content data (for new content pointer)
      const parentBlock = Block.fromFullBytes(parentBlockData);
      parentContentHash = parentBlock.value.content.key;

      // retrieve all blocks pending for this chain
      const blocksPendingForThisChain = this.pendingBlocksByChain[chainIndex];

      // retrieve the block id for the challenge referenced
      const parentProofBlockHash = this.proof2BlockMap.get(proof.value.previousProofHash);
      if (!parentProofBlockHash) {
        throw new Error('Cannot get parent proof block hash when extending the chain');
      }

      // ensure the parent proof is still unconfirmed, else this proof (and block) are no longer valid for this chain
      if (!blocksPendingForThisChain.has(parentProofBlockHash)) {
        if (areArraysEqual(parentBlock.value.proof.value.previousProofHash, proof.value.previousProofHash)) {
          // we have a fork, see which one is higher quality
          const chunkTarget = crypto.hash(crypto.hash(proof.value.previousProofHash)).subarray(0, 8);
          const incumbentBlockQuality = measureProximity(chunkTarget, parentBlock.value.proof.value.solution);
          const challengerBlockQuality = measureProximity(chunkTarget, proof.value.solution);

          if (challengerBlockQuality > incumbentBlockQuality) {
            // revert the chain
            // need to still return the block here -- then handle the fork in apply block
            this.logger.warn('******* Valid Fork, Chain should revert here ******');
          }
        }
        // either the chain has been extended more that one block (proofs do not match)
        // or they have the same proof and the challenger quality is lower
        this.logger.debug('Potential block does not have a valid proof for ledger');
        this.logger.debug([...blocksPendingForThisChain.values()]);
        return;
      }
    } else {
      // genesis block for this chain
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
    // ToDo
      // return false if
        // parent proof has not yet been seen
        // piece/piece-proof refrences unknown state
        // references a tx that has not been seen yet
      // on isValid -> wait at some interval before checking if isValid again
      // validate nodes are not adding txs that have already been announced by their ancestors

    // validate the block, proof, content, and coinbase tx are all well formed, will throw if not
    block.isValid(this.blsSignatures);

    // verify the proof

    // previous proof hash is in proof map
    if (!(await this.getProof(block.value.proof.value.previousProofHash))) {
      if (!areArraysEqual(block.value.proof.value.previousProofHash, new Uint8Array(32))) {
        this.logger.error('Invalid block proof, points to an unknown previous proof');
        throw new Error('Invalid block proof, points to an unknown previous proof');
      }
    }

    // proof has not been seen on this chain yet
    const chainIndex = crypto.jumpHash(block.value.proof.key, this.chainCount);
    const pendingBlocksForChain = this.pendingBlocksByChain[chainIndex];
    const parentProofBlockHash = this.proof2BlockMap.get(block.value.proof.value.previousProofHash);

    if (!parentProofBlockHash && !(areArraysEqual(block.value.proof.value.previousProofHash, new Uint8Array(32)))) {
      throw new Error('Cannot get block id for proof when validating block');
    }

    if (parentProofBlockHash && !pendingBlocksForChain.has(parentProofBlockHash)) {
      throw new Error('Invalid block proof, parent proof (challenge) has already been confirmed for this chain');
    }

    // piece is within the scope of the audit (closest piece for now)
      // to fully verify I need every piece ID for the entire ledger
        // 512 hashes per MB 1.5k -> 1/1000th of the ledger size
        // 1 TB Ledger means 1 GB of hashes
        // 1 PB Ledger means 1 TB of hashes
      // What can a light client do?
        // expect the piece to meet some minimum proximity
        // simply revise the piece if they hear of a better one
        // this has more to do with gosssiping piece than with consensus proper

    // chunk proximity meets the threshold (maybe more as a rough guide) than absolute requirement
      // first variable is the number of unique pieces for a given challenge (scope), assume 1 to start
      // second variable is the average quality over the last period from the last state block
      // then apply the same rules as piece quality
        // if you hear a better one revise your piece

    // solution is the best piece yet seen for this challenge on this chain (if last block uses same challenge)
      // revert the old block
      // apply this block instead
      // eventually will need to check total chain/ledger quality (assuming that block has been referenced by other blocks)

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

    // piece references a known state
    if (!this.stateMap.has(block.value.proof.value.pieceStateHash) && areArraysEqual(block.value.proof.value.pieceStateHash, new Uint8Array(32))) {
      this.logger.error('Invalid block proof, referenced piece level is unknown');
      throw new Error('Invalid block proof, referenced piece level is unknown');
    }

    // piece merkle proof is valid for a given state level
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

    // encoding decodes pack to piece
    const proverAddress = crypto.hash(block.value.proof.value.publicKey);
    const piece = codes.decodePiece(encoding, proverAddress, this.encodingRounds);
    const pieceHash = crypto.hash(piece);

    if (!areArraysEqual(pieceHash, block.value.proof.value.pieceHash)) {
      this.logger.error('Invalid block proof, encoding does not decode back to parent piece');
      throw new Error('Invalid block proof, encoding does not decode back to parent piece');
    }

    // check that the parent content hash is on the correct chain
    if (areArraysEqual(block.value.content.value.parentContentHash, new Uint8Array(32))) {
      const chain = this.chains[chainIndex];

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

      if (parentChainIndex !== chainIndex) {
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

      // ensure the tx has not been included in an ancestor block
      // const blocksClaimingThisTx = this.blocksClaimingTx.get(tx.key);

      // if (!blocksClaimingThisTx) {
      //   throw new Error('Canot find blocks claiming tx value for this tx, that exist in tx map');
      // }

      // for (const blockId of blocksClaimingThisTx.values()) {
      //   // is this block an ancestor of the current block?
      //   // how far back should you look?
      //   // corner case now for malicous node, solve later
      //   this.logger.verbose(`Block has included tx already referenced by another block with id: ${bin2Hex(blockId).substr(0, 12)}`);
      // }
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
   * Called when a new valid block has been created locally or received over the network.
   * Applies the block to the ledger, checks if the level is confirmed, and if state can be encoded.
   *
   * @param block the fully formed block instance to be applied
   */
  public async applyBlock(block: Block): Promise<void> {
    // extend the correct chain with block id and add to compact block map
    const chainIndex = crypto.jumpHash(block.value.proof.key, this.chainCount);
    const parentBlockId = this.chains[chainIndex].head;
    this.chains[chainIndex].addBlock(block.key);
    this.compactBlockMap.set(block.key, block.toCompactBytes());
    this.previousBlockHash = block.key;

    // store the proof
    this.proof2BlockMap.set(block.value.proof.key, block.key);
    const proofData = block.value.proof.toBytes();
    this.proofMap.set(block.value.proof.key, proofData);
    this.parentProofHash = block.value.proof.key;

    // store the content
    this.content2BlockMap.set(block.value.content.key, block.key);
    const contentData = block.value.content.toBytes();
    this.contentMap.set(block.value.content.key, contentData);

    if (parentBlockId.length === 32) {

      // insert block into the appropriate level
      const parentBlockLevelIndex = this.levelForPendingBlock.get(parentBlockId);
      if (parentBlockLevelIndex === undefined) {
        this.logger.verbose(`Parent block ID: ${bin2Hex(parentBlockId)}`);
        this.logger.verbose(`Parent block level index is: ${parentBlockLevelIndex}`);
        console.log(this.levelForPendingBlock);
        throw new Error('Cannot get level for parent block');
      }

      // get or create the level for the new pending block
      let pendingBlocksForLevel = this.pendingBlocksByLevel.get(parentBlockLevelIndex + 1);
      if (!pendingBlocksForLevel) {
        // if null level, then create the new level
        pendingBlocksForLevel = ArrayMap<Uint8Array, number>();
      }

      // add the counter for this blocks level and set
      pendingBlocksForLevel.set(block.key, this.chainCount);
      this.pendingBlocksByLevel.set(parentBlockLevelIndex + 1, pendingBlocksForLevel);

      // record the level for this block
      this.levelForPendingBlock.set(block.key, parentBlockLevelIndex + 1);
      this.logger.verbose(`Added pending block ${bin2Hex(block.key).substring(0, 12)} to level ${parentBlockLevelIndex + 1}`);

    } else {
      // genesis block

      let pendingBlocksForLevel = this.pendingBlocksByLevel.get(0);
      if (!pendingBlocksForLevel) {
        // if null level, then create the new level
        pendingBlocksForLevel = ArrayMap<Uint8Array, number>();
      }
      pendingBlocksForLevel.set(block.key, this.chainCount);
      this.pendingBlocksByLevel.set(0, pendingBlocksForLevel);
      this.levelForPendingBlock.set(block.key, 0);
      this.logger.verbose(`Added pending block ${bin2Hex(block.key).substring(0, 12)} to level ${0}`);
    }

    // add this block as pending confirmation for each chain
    for (const chain of this.pendingBlocksByChain) {
      chain.add(block.key);
    }

    // check which pending blocks for this chain that this block confirms
    // start by get the pending blocks for this chain
    const blocksPendingForThisChain = this.pendingBlocksByChain[chainIndex];

    // skip the genesis block
    if (!areArraysEqual(block.value.proof.value.previousProofHash, new Uint8Array(32))) {
      // confirm the challenge for this chain
      // get the block id of parent proof and remove from pending blocks for this chain
      const parentProofBlockHash = this.proof2BlockMap.get(block.value.proof.value.previousProofHash);

      if (!parentProofBlockHash) {
        throw new Error('Cannot retrieve block id for challenge referenced in block');
      }

      if (!blocksPendingForThisChain.has(parentProofBlockHash)) {
        throw new Error('Block with parent proof should not be confirmed for this chain yet');
      }

      blocksPendingForThisChain.delete(parentProofBlockHash);
      this.confirmChainForPendingBlock(parentProofBlockHash);

      // confirm the last block for this chain
      // skip the first block on each chain
      if (parentBlockId.length === 32) {
        // get the block id of parent content and remove from pending blocks for this chain
        const parentContentBlockHash = this.content2BlockMap.get(block.value.content.value.parentContentHash);

        if (!parentContentBlockHash) {
          throw new Error('Cannot retrieve block id for parent content referenced in block');
        }

        if (!blocksPendingForThisChain.has(parentContentBlockHash) && !areArraysEqual(parentContentBlockHash, parentProofBlockHash)) {
          // unless the proof came from parent content block
          throw new Error('Parent content block for this block should not be confirmed for this chain yet');
        }

        // dont try and confirm the same block twice for one chain
        if (!areArraysEqual(parentProofBlockHash, parentContentBlockHash)) {
          blocksPendingForThisChain.delete(parentContentBlockHash);
          this.confirmChainForPendingBlock(parentContentBlockHash);
        }
      }

      this.logger.verbose('Confirming all blocks from parent proof chain');

      // remove all blocks confirmed on parent proof chain from blocks pending for this chain
      const chainIndexForParentProof = crypto.jumpHash(block.value.proof.value.previousProofHash, this.chainCount);
      const blocksPendingConfirmationForParentProof = this.pendingBlocksByChain[chainIndexForParentProof];
      for (const blockPendingForThisChain of blocksPendingForThisChain.values()) {
        if (!blocksPendingConfirmationForParentProof.has(blockPendingForThisChain)) {
          blocksPendingForThisChain.delete(blockPendingForThisChain);
          this.confirmChainForPendingBlock(blockPendingForThisChain);
        }
      }
    }

    // when a chain is confimred for a block, we check if the block is confirmed, then the level, and encode state as needed

    // add the coinbase tx txset
    const coinbase = block.value.coinbase;
    this.txMap.set(coinbase.key, coinbase.toBytes());
    this.applyTx(coinbase);
    this.unencodedTxs.add(coinbase.key);

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
      this.unencodedTxs.add(txId);
    }
    this.logger.verbose('Completed applying new block');
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

    // add the tx to
    // const
    // this.blocksClaimingTx.add()

    // apply the fee to the farmer?
    // note when tx is referenced (added to a block)
    // note when tx is confirmed (a block referencing is captured in a level)
    // note when tx is deep confirmed (N other levels have also been confirmed, 6?)
}

  /**
   * Confirms a single chain for a block and checks if the block is now confirmed
   *
   * @param blockId
   */
  private confirmChainForPendingBlock(blockId: Uint8Array): void {

    const pendingBlockLevelIndex = this.levelForPendingBlock.get(blockId);

    if (pendingBlockLevelIndex === undefined) {
      throw new Error('Cannot retrieve level index for pending block that needs to have chain count decremented');
    }

    const pendingBlocks = this.pendingBlocksByLevel.get(pendingBlockLevelIndex);
    // const pendingBlocks = this.pendingBlocksByLevel[pendingBlockLevelIndex];

    if (!pendingBlocks) {
      throw new Error ('Cannot retrieve level for pending block that needs to have chain count decremented');
    }

    let pendingChainCount = pendingBlocks.get(blockId);

    if (pendingChainCount === undefined) {
      console.log(`Searching for block ${bin2Hex(blockId).substring(0, 12)} at index ${pendingBlockLevelIndex}`);
      console.log(this.pendingBlocksByLevel.size);
      for (const [level, entries] of this.pendingBlocksByLevel.entries()) {
        console.log('Level: ', level);
        for (const [blockId, chainCount] of entries.entries()) {
          console.log(`${bin2Hex(blockId).substring(0, 12)}: ${chainCount}`);
        }
      }
      throw new Error('Cannot get pending block from pending block map for block that needs to have chain count decremented');
    }

    pendingChainCount --;
    pendingBlocks.set(blockId, pendingChainCount);

    if (pendingChainCount === 0) {
      // this block is confirmed on all chains

      // remove the block from pending block map
      this.levelForPendingBlock.delete(blockId);

      // check if all blocks at this index are confirmed
      for (const unconfirmedChainCount of pendingBlocks.values()) {
        if (unconfirmedChainCount !== 0) {
          return;
        }
      }

      // confirm and encode all blocks at this index
      this.confirmLevel(pendingBlockLevelIndex);
    }
  }

  /**
   * Compiles new records for pending state when for all blocks within a new confirmed level
   *
   * @param levelIndex the height of the block tree that is being confirmed
   */
  private async confirmLevel(levelIndex: number): Promise<void> {

    // get all blocks for pending level
    const confirmedBlocks = this.pendingBlocksByLevel.get(levelIndex);
    // const confirmedBlocks = this.pendingBlocksByLevel[levelIndex];

    if (!confirmedBlocks) {
      throw new Error('Cannot get confirmed blocks for new confirmed level');
    }

    const newRecords: Uint8Array[] = [];
    const uniqueTxSet: Set<Uint8Array> = ArraySet();
    let latestTxTime: number = 0;

    // canonicaly order the blocks
    const confirmedBlockSet = ArraySet([...confirmedBlocks.keys()]);
    const sortedBlocks = sortSet(confirmedBlockSet);

    // retrieve and comiple the data for each block
    for (const blockHash of sortedBlocks) {
      this.blockIndex.set(this.blockIndex.size, blockHash);
      const blockData = await this.getBlock(blockHash);

      if (!blockData) {
        throw new Error('Cannot retrieve block for state encoding');
      }

      // add proof and content to pending records
      const block = Block.fromFullBytes(blockData);
      const proofData = block.value.proof.toBytes();
      const proofLength = smallNum2Bin(proofData.length);
      const contentData = block.value.content.toBytes();
      const contentLength = smallNum2Bin(contentData.length);
      newRecords.push(proofLength, proofData, contentLength, contentData);

      // collect all the txs in the set
      for (const txHash of block.value.content.value.payload) {
        uniqueTxSet.add(txHash);
      }
    }

    const confirmedUnencodedTxs = [...uniqueTxSet.values()].filter((txId) => this.unencodedTxs.has(txId));
    const unsortedTxSet = ArraySet(confirmedUnencodedTxs);
    const sortedTxSet = sortSet(unsortedTxSet);

    // filter for duplicate txs and encode
    for (const txHash of sortedTxSet.values()) {
      this.unencodedTxs.delete(txHash);
      const txData = await this.getTx(txHash);

      if (!txData) {
        throw new Error('Cannot retrieve tx for state encoding');
      }

      const tx = Tx.fromBytes(txData);
      if (tx.value.timestamp > latestTxTime) {
        latestTxTime = tx.value.timestamp;
      }

      const txLength = smallNum2Bin(txData.length);
      newRecords.push(txLength, txData);
    }

    // compile new records and add to pending state
    const newState = Buffer.concat(newRecords);
    this.pendingState = Buffer.concat([this.pendingState, newState]);

    // check if state needs to be encoded
    while (this.pendingState.length >= 127 * 4096) {
      await this.createState(latestTxTime);
    }

    // output log info for new confimred level
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
  private async createState(timestamp: number): Promise<void> {
    return new Promise(async (resolve) => {
      // we need to only take the first 127 pieces
      const stateData = this.pendingState.subarray(0, 4096 * 127);

      // assign the remainder back to the pending state
      this.pendingState = this.pendingState.subarray(4096 * 127);

      // erasure code the source state
      const { state, pieceDataSet } = await codes.encodeState(stateData, this.previousStateHash, timestamp);

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
