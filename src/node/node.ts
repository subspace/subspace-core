// tslint:disable: no-console
// tslint:disable: member-ordering

import { EventEmitter } from 'events';
import * as crypto from '../crypto/crypto';
import { Farm } from '../farm/farm';
import { Block } from '../ledger/block';
import { Ledger } from '../ledger/ledger';
import { Proof } from '../ledger/proof';
import { Tx } from '../ledger/tx';
import { CHUNK_LENGTH, COINBASE_REWARD, PIECE_SIZE } from '../main/constants';
import { INodeConfig, INodeSettings } from '../main/interfaces';
import { RPC } from '../network/rpc';
import { bin2Hex, measureProximity, randomWait } from '../utils/utils';
import { Wallet } from '../wallet/wallet';

// ToDo
  // add time logging
  // sync an existing ledger

export class Node extends EventEmitter {

  constructor(
    public readonly type: 'full' | 'validator' | 'farmer' | 'gateway' | 'client',
    public readonly config: INodeConfig,
    public readonly settings: INodeSettings,
    private rpc: RPC,
    private ledger: Ledger,
    private wallet: Wallet | undefined,
    private farm: Farm | undefined,
  ) {

    super();
    this.rpc.on('ping', (payload, responseCallback: (response: Uint8Array) => void) => {
      console.log('Received a ping request');
      responseCallback(payload);
    });
    this.rpc.on('pong', () => {
      console.log('received a pong response');
      this.emit('pong');
    });
    this.rpc.on('tx-gossip', (tx: Tx) => this.onTx(tx));
    this.rpc.on('block-gossip', (block: Block, encoding: Uint8Array) => this.onBlock(block, encoding));
    this.rpc.on('tx-request', (txId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onTxRequest(txId, responseCallback));
    this.rpc.on('block-request', (blockId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onBlockRequest(blockId, responseCallback));

    /**
     * A new level has been confirmed and encoded into a piece set.
     * Add each piece to the plot, if farming.
     */
    this.ledger.on('confirmed-level', async (levelRecords: Uint8Array[], levelHash: Uint8Array, confirmedTxs: Tx[]) => {
      if (this.farm) {
        // how do you prevent race conditions here, a piece maybe partially plotted before it can be evaluated...
        const pieceDataSet = await ledger.encodeLevel(levelRecords, levelHash);
        if (this.farm) {
          for (const piece of pieceDataSet) {
            await this.farm.addPiece(piece.piece, piece.data);
          }
          this.ledger.emit('completed-plotting');
        }
      }

      // update account for each tx that links to an account for this node
      if (this.wallet) {
        const addresses = this.wallet.addresses;
        for (const tx of confirmedTxs) {
          if (addresses.has(bin2Hex(tx.senderAddress)) || addresses.has(bin2Hex(tx.receiverAddress))) {
            await this.wallet.onTxConfirmed(tx);
          }
        }
      }
    });

    /**
     * A new block was created by this farmer from Ledger after solving the block challenge.
     * Encode the block as binary and gossip over the network.
     */
    this.ledger.on('block', async (block: Block, encoding: Uint8Array) => {
      console.log('New block received by Node.');
      if (this.ledger.isValidating) {
        await this.ledger.isValidBlock(block, encoding);
        console.log('New block validated by node');
      }

      this.rpc.gossipBlock(block);
    });

    /**
     * A new credit tx was created by this node and applied to the local ledger.
     * Encode the tx as binary and gossip over the network.
     */
    this.ledger.on('tx', (tx: Tx) => {
      this.rpc.gossipTx(tx);
    });

    switch (this.type) {
      case 'full':
        this.createLedgerAndFarm(this.settings.numberOfChains);
        break;
      case 'validator':
        this.syncLedgerAndValidate();
        break;
    }
  }

  /**
   * Starts a new ledger from genesis and begins farming its own plot in isolation. Mostly for testing.
   * Retains both the original ledger data within storage and the encoded piece set in the plot.
   */
  public async createLedgerAndFarm(chainCount: number): Promise<void> {
    if (!this.farm || !this.wallet) {
      throw new Error('Cannot farm, this node is not configured as a farmer');
    }
    const account = this.wallet.getAccounts()[0];
    console.log('\nLaunching a new Subspace Full Node!');
    console.log('-----------------------------------\n');
    console.log(`Created a new node identity with address ${bin2Hex(account.address)}`);
    console.log(`Starting a new ledger from genesis with ${chainCount} chains.`);
    const [levelRecords, levelHash] = await this.ledger.createGenesisLevel(chainCount);
    const pieceSet = await this.ledger.encodeLevel(levelRecords, levelHash);
    console.log(`Created the genesis level and derived ${pieceSet.length} new pieces`);
    for (const piece of pieceSet) {
      await this.farm.addPiece(piece.piece, piece.data);
    }
    console.log(`Completed plotting ${pieceSet.length} pieces for the genesis level.`);

    // start a farming evaluation loop
    while (this.config.farm) {
      await this.farmBlock();
    }
  }

  public async farmBlock(): Promise<void> {
    await randomWait(5000);
    if (!this.farm || !this.wallet) {
      throw new Error('Cannot farm, this node is not configured as a farmer');
    }
    // find best encoding for challenge
    console.log('\nSolving a new block challenge');
    console.log('------------------------------');
    console.log(`State: ${this.ledger.stateMap.size} levels`);
    console.log(`Ledger; ${this.ledger.compactBlockMap.size} blocks`);
    const pieceCount = this.farm.getPieceCount();
    const plotSize = this.farm.getSize() / 1000000;
    console.log(`Farm: ${pieceCount} pieces comprising ${plotSize} MB across ${this.farm.plots.length} plots`);
    console.log(`Balance: ${this.wallet.getPendingBalanceOfAllAccounts()} credits`);
    console.log('------------------------------\n');

    const previousLevelHash = this.ledger.previousLevelHash;
    const parentProofHash = this.ledger.parentProofHash;
    const seed = Buffer.concat([previousLevelHash, parentProofHash]);
    const pieceTarget = crypto.hash(seed);
    const closestEncodings = await this.farm.getClosestEncodings(pieceTarget);
    if (!closestEncodings) {
      throw new Error('Cannot find a piece within plot for target');
    }
    console.log(`Closest piece to target: ${bin2Hex(pieceTarget).substr(0, 16)} is ${bin2Hex(closestEncodings.data.pieceHash).substring(0, 16)}`);

    let encodingIndex = 0;
    let bestChunkQuality = 0;
    let bestChunk = new Uint8Array();
    const chunkTarget = crypto.hash(pieceTarget).subarray(0, 8);

    // tslint:disable-next-line: prefer-for-of
    for (let p = 0; p < closestEncodings.encodings.length; ++p) {
      // find best chunk for challenge
      for (let i = 0; i < PIECE_SIZE / CHUNK_LENGTH; ++i) {
        const chunk = closestEncodings.encodings[p].subarray(i * CHUNK_LENGTH, (i + 1) * CHUNK_LENGTH);
        const quality = measureProximity(chunk, chunkTarget);
        if (quality > bestChunkQuality) {
          bestChunkQuality = quality;
          bestChunk = chunk;
          encodingIndex = p;
        }
      }
    }

    console.log(`Closest chunk to target: ${bin2Hex(chunkTarget)} is ${bin2Hex(bestChunk)} from plot ${encodingIndex}`);

    const encoding = closestEncodings.encodings[encodingIndex];
    const account = this.wallet.getAccount(this.farm.getPlotAddress(encodingIndex));

    // create proof of storage
    const unsignedProof = await Proof.create(
      previousLevelHash,
      parentProofHash,
      bestChunk,
      closestEncodings.data.pieceHash,
      closestEncodings.data.stateHash,
      closestEncodings.data.proof,
      account.publicKey,
    );
    const signedProof = this.wallet.signProof(unsignedProof);

    // create coinbase tx
    const coinbaseTx = await this.wallet.createCoinBaseTx(COINBASE_REWARD, account.publicKey);
    await this.ledger.createBlock(signedProof, coinbaseTx, encoding);
  }

  /**
   * Syncs the ledger from the network and begins farming. Default startup procedure for farmers.
   * Discards the original ledger data after several confirmed levels while retaining only the encoded pieces within its plot.
   */
  public async syncLedgerAndFarm(): Promise<void> {
    return;
  }

  /**
   * Syncs the ledger from the network.
   * Validates and forwards new blocks and txs received over the network.
   */
  public async syncLedgerAndValidate(): Promise<void> {
    console.log('\nLaunching a new Subspace Validator Node!');
    console.log('-----------------------------------\n');
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

  public async ping(nodeId: Uint8Array, payload?: Uint8Array): Promise<void> {
    await this.rpc.ping(nodeId, payload);
  }

  /**
   * A new tx is received over the network from another node.
   * Filter the tx for duplicates or spam. Validate the tx.
   * Apply the tx to the ledger and gossip to all other peers.
   */
  public async onTx(tx: Tx): Promise<void> {
    if (this.ledger.isValidTx(tx)) {
      this.ledger.applyTx(tx);
      this.rpc.gossipTx(tx);
      if (this.wallet) {
        const addresses = this.wallet.addresses;
        if (addresses.has(bin2Hex(tx.receiverAddress))) {
          this.wallet.onTxReceived(tx);
        }
      }
    }

    // ToDo
      // filter duplicates and prevent re-gossip to sender
  }

  /**
   * A new block is received over the network from another farmer.
   * Filter the block for duplicates or spam. Validate the block.
   * Apply the block to the ledger and gossip to all other peers.
   */
  public async onBlock(block: Block, encoding: Uint8Array): Promise<void> {
    if (this.ledger.isValidBlock(block, encoding)) {
      this.ledger.applyBlock(block);
      this.rpc.gossipBlock(block);
    }

    // ToDo
      // filter duplicates and prevent re-gossip to sender
  }

  /**
   * Request a tx over the network from an existing peer.
   *
   * @param txId
   *
   * @return tx instance or not found
   */
  public async requestTx(txId: Uint8Array): Promise<Tx> {
    return this.rpc.requestTx(new Uint8Array(), txId);
    // TODO
      // apply tx, error specify error callback
  }

  /**
   * Received a tx request over the network, reply with tx or not found.
   *
   * @param txId
   * @param responseCallback
   *
   */
  private async onTxRequest(txId: Uint8Array, responseCallback: (response: Uint8Array) => void): Promise<void> {
    const txData = await this.ledger.getTx(txId);
    txData ? responseCallback(txData) : responseCallback(new Uint8Array());
  }

  /**
   * Request a block over the network from an existing peer.
   *
   * @param blockId
   *
   * @return block instance or not found
   */
  public async requestBlock(blockId: Uint8Array): Promise<Block> {
    return this.rpc.requestBlock(new Uint8Array(), blockId);
    // TODO
      // apply block, error specify error callback
  }

  /**
   * Received a block request over the network, reply with block or not found.
   *
   * @param blockId
   * @param responseCallback
   *
   */
  private async onBlockRequest(blockId: Uint8Array, responseCallback: (response: Uint8Array) => void): Promise<void> {
    const blockData = await this.ledger.getBlock(blockId);
    blockData ? responseCallback(blockData) : responseCallback(new Uint8Array());
  }
}
