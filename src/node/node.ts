// tslint:disable: no-console

import * as crypto from '../crypto/crypto';
import { Farm } from '../farm/farm';
import { Block } from '../ledger/block';
import { Ledger } from '../ledger/ledger';
import { Proof } from '../ledger/proof';
import { Tx } from '../ledger/tx';
import { COINBASE_REWARD, HASH_LENGTH, PIECE_SIZE } from '../main/constants';
import { IBlockData, IPiece, ITxData } from '../main/interfaces';
import { measureProximity } from '../utils/utils';
import { Wallet } from '../wallet/wallet';

// ToDo
  // detect type of storage for storage adapter
  // start a new ledger
  // define the full API
  // include the RPC interface
  // sync an existing ledger

export class Node {

  /**
   * Instantiate a new empty node with only environment variables.
   */
  public static async init(storageAdapter = 'rocks', mode: typeof Farm.MODE_MEM_DB | typeof Farm.MODE_DISK_DB = 'mem-db'): Promise<Node> {
    const wallet = await Wallet.init(storageAdapter);
    const farm = await Farm.init(storageAdapter, mode);
    const ledger = await Ledger.init(storageAdapter);
    return new Node(wallet, farm, ledger);
  }

  public isFarming = true;
  public isRelay = true;
  public isServing = true;

  public wallet: Wallet;
  public farm: Farm;
  public ledger: Ledger;
  public rpc: any; // just a placeholder for now

  constructor(wallet: Wallet, farm: Farm, ledger: Ledger) {
    this.wallet = wallet;
    this.farm = farm;
    this.ledger = ledger;

    /**
     * A new level has been confirmed and encoded into a piece set.
     * Add each piece to the plot, if farming.
     */
    this.ledger.on('confirmed-level', async (pieceDataSet: IPiece[]) => {
      if (this.isFarming) {
        // how do you prevent race conditions here, a piece maybe partially plotted before it can be evaluated...
        for (const piece of pieceDataSet) {
          await this.farm.addPiece(piece.piece, piece.data);
        }
        this.ledger.emit('completed-plotting');
      }
    });

    /**
     * A new block was created by this farmer from Ledger after solving the block challenge.
     * Encode the block as binary and gossip over the network.
     */
    this.ledger.on('block', (block: Block) => {
      return;
      // encode to binary
      // wrap in message
      this.rpc.gossip(block.toData());
    });

    /**
     * A new credit tx was created by this node and applied to the local ledger.
     * Encode the tx as binary and gossip over the network.
     */
    this.ledger.on('tx', (tx: Tx) => {
      return;
      // encode to binary
      // wrap in message
      this.rpc.gossip(tx.toData());
    });

    /**
     * A new block is received over the network from another farmer.
     * Filter the block for duplicates or spam. Validate the block.
     * Apply the block to the ledger and gossip to all other peers.
     */
    this.rpc.on('block', (blockData: IBlockData) => {
      return;
      // filter
      // validate
      // apply
      // re-gossip
      const block = Block.load(blockData);
      if (this.ledger.isValidBlock(block)) {
        this.ledger.applyBlock(block);
        this.rpc.gossip(blockData);
      }
    });

    /**
     * A new tx is received over the network from another node.
     * Filter the tx for duplicates or spam. Validate the tx.
     * Apply the tx to the ledger and gossip to all other peers.
     */
    this.rpc.on('tx', (txData: ITxData) => {
      return;
      // filter
      // validate
      // apply
      // re-gossip
      const tx = Tx.load(txData);
      if (this.ledger.isValidTx(tx)) {
        this.ledger.applyTx(tx);
        this.rpc.gossip(txData);
      }
    });
  }

  /**
   * Looks for an existing address within the wallet, creating a new one if one does not exist.
   */
  public async getOrCreateAddress(): Promise<void> {
    const existingAddress = await this.wallet.setMasterKeyPair();
    if (!existingAddress) {
      const seed = crypto.randomBytes(32);
      await this.wallet.createKeyPair(seed);
      await this.wallet.setMasterKeyPair();
    }
  }

  /**
   * Tests the plotting workflow for some random data.
   */
  // public async plot(): Promise<void> {
  //   const data = crypto.randomBytes(520191);
  //   const paddedData = codes.padLevel(data);
  //   const encodedData = await codes.erasureCodeLevel(paddedData);
  //   const pieceSet = codes.sliceLevel(encodedData);
  //   await this.farm.initPlot(this.address, pieceSet);
  //   console.log(`Completed plotting ${pieceSet.length} pieces.`);
  // }

  /**
   * Starts a new ledger from genesis and begins farming its own plot in isolation. Mostly for testing.
   * Retains both the original ledger data within storage and the encoded piece set in the plot.
   */
  public async createLedgerAndFarm(chainCount: number): Promise<void> {
    this.isFarming = true;
    this.getOrCreateAddress();
    const pieceSet = await this.ledger.createGenesisLevel(chainCount);
    for (const piece of pieceSet) {
      await this.farm.addPiece(piece.piece, piece.data);
    }

    // start a farming evaluation loop
    while (this.isFarming) {
      // find best encoding for challenge
      const previousLevelHash = this.ledger.previousLevelHash;
      const parentProofHash = this.ledger.parentProofHash;
      const seed = Buffer.concat([previousLevelHash, parentProofHash]);
      const pieceTarget = crypto.hash(seed);
      const closestEncoding = await this.farm.getClosestEncoding(pieceTarget);
      if (!closestEncoding) {
        throw new Error('Cannot find a piece within plot for target');
      }

      const encoding = closestEncoding.encoding;
      let bestChunkQuality = 0;
      let bestChunk = new Uint8Array();
      const chunkTarget = crypto.hash(pieceTarget);

      // find best chunk for challenge
      for (let i = 0; i < PIECE_SIZE / HASH_LENGTH; ++ i) {
        const chunk = encoding.subarray(i * HASH_LENGTH, (i + 1) * HASH_LENGTH);
        const quality = measureProximity(chunk, chunkTarget);
        if (quality > bestChunkQuality) {
          bestChunkQuality = quality;
          bestChunk = chunk;
        }
      }

      // create proof of storage
      const unsignedProof = await Proof.create(
        previousLevelHash,
        parentProofHash,
        bestChunk,
        closestEncoding.data.pieceHash,
        closestEncoding.data.levelIndex,
        closestEncoding.data.proof,
        this.wallet.publicKey,
      );
      const signedProof = this.wallet.signProof(unsignedProof);

      // create coinbase tx
      const coinbaseTx = await this.wallet.createCoinBaseTx(COINBASE_REWARD);
      await this.ledger.createBlock(signedProof, coinbaseTx);

      // plot the new piece set when a level is confirmed
    }
    return;
  }

  /**
   * Syncs the ledger from the network and begins farming. Default startup procedure for farmers.
   * Discards the original ledger data after several confirmed levels while retaining only the encoded pieces within its plot.
   */
  public async syncLedgerAndFarm(): Promise<void> {
    return;
  }

  /**
   * Syncs the ledger from existing nodes and serves RPC requests for structured data. Equivalent to a full validator node.
   * Retains the full unencoded ledger within persistent storage.
   */
  public async syncLedgerAndServe(): Promise<void> {
    return;
  }

  /**
   * Syncs the state chain from the network. Equivalent to a light client.
   * Listens for and validates new blocks, discarding them as they are compressed into new state blocks.
   */
  public async syncStateAndListen(): Promise<void> {
    return;
  }
}
