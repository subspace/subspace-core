// tslint:disable: no-console
// tslint:disable: member-ordering

// import * as codes from '../codes/codes';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {BlsSignatures} from "../crypto/BlsSignatures";
import * as crypto from '../crypto/crypto';
import { Farm } from '../farm/farm';
import { Block } from '../ledger/block';
import { Ledger } from '../ledger/ledger';
import { Proof } from '../ledger/proof';
import { Tx } from '../ledger/tx';
import { CHUNK_LENGTH, COINBASE_REWARD, PIECE_SIZE } from '../main/constants';
import { IPeerContactInfo } from '../main/interfaces';
import { Network } from '../network/Network';
import { RPC } from '../network/rpc';
import { bin2Hex, hex2Bin, measureProximity, parseContactInfo, rmDirRecursiveSync } from '../utils/utils';
import { IWalletAccount, Wallet } from '../wallet/wallet';

// ToDo
  // add time logging
  // pass in and create storage path at startup with sensible default
  // detect type of storage for storage adapter
  // define the full API
  // include the RPC interface
  // sync an existing ledger

export class Node extends EventEmitter {

  /**
   * Instantiate a new empty node with only environment variables.
   */
  public static async init(
    selfContactInfo: IPeerContactInfo,
    peerContactInfo: IPeerContactInfo[],
    nodeType: string,
    storageAdapter = 'rocks',
    plotMode: typeof Farm.MODE_MEM_DB | typeof Farm.MODE_DISK_DB = 'mem-db',
    numberOfPlots: number,
    farmSize: number,
    validateRecords: boolean,
    encodingRounds: number,
    storageDir?: string,
    reset = true,
  ): Promise<Node> {

    // initialize storage directory
    storageDir ? storageDir = path.normalize(storageDir) : storageDir = `${os.homedir()}/subspace/data/`;

    if (reset && fs.existsSync(storageDir)) {
     rmDirRecursiveSync(storageDir);
    }

    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    const blsSignatures = await BlsSignatures.init();
    const wallet = await Wallet.open(blsSignatures, storageAdapter, storageDir);

    for (let i = 0; i < numberOfPlots; ++i) {
      await wallet.createAccount(`Plot-${i}`);
    }

    const addresses = [...wallet.addresses].map((address) => hex2Bin(address));

    const ledger = await Ledger.init(blsSignatures, storageAdapter, storageDir, validateRecords, encodingRounds);
    const farm = new Farm(plotMode, storageDir, numberOfPlots, farmSize, encodingRounds, addresses);

    selfContactInfo.nodeId = addresses[0];

    const networkOptions = parseContactInfo(selfContactInfo, peerContactInfo);

    const network = new Network(...networkOptions);

    const rpc = new RPC(network);

    return new Node(nodeType, wallet, farm, ledger, rpc);
  }

  public readonly type: string;
  public isFarming = true;
  public isRelay = true;
  public isServing = true;

  constructor(
    nodeType: string,
    public wallet: Wallet,
    public farm: Farm,
    public ledger: Ledger,
    public rpc: RPC,
  ) {

    super();
    this.type = nodeType;
    this.rpc.on('ping', (payload, responseCallback: (response: Uint8Array) => void) => responseCallback(payload));
    this.rpc.on('pong', () => this.emit('pong'));
    this.rpc.on('tx-gossip', (tx: Tx) => this.onTx(tx));
    this.rpc.on('block-gossip', (block: Block, encoding: Uint8Array) => this.onBlock(block, encoding));
    this.rpc.on('tx-request', (txId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onTxRequest(txId, responseCallback));
    this.rpc.on('block-request', (blockId: Uint8Array, responseCallback: (response: Uint8Array) => void) => this.onBlockRequest(blockId, responseCallback));

    /**
     * A new level has been confirmed and encoded into a piece set.
     * Add each piece to the plot, if farming.
     */
    this.ledger.on('confirmed-level', async (levelRecords: Uint8Array[], levelHash: Uint8Array, confirmedTxs: Tx[]) => {
      if (this.isFarming) {
        // how do you prevent race conditions here, a piece maybe partially plotted before it can be evaluated...
        const pieceDataSet = await ledger.encodeLevel(levelRecords, levelHash);
        for (const piece of pieceDataSet) {
          await this.farm.addPiece(piece.piece, piece.data);
        }
        this.ledger.emit('completed-plotting');
      }

      // update account for each tx that links to an account for this node
      const addresses = this.wallet.addresses;
      for (const tx of confirmedTxs) {
        if (addresses.has(bin2Hex(tx.senderAddress)) || addresses.has(bin2Hex(tx.receiverAddress))) {
          await wallet.onTxConfirmed(tx);
        }
      }
    });

    /**
     * A new block was created by this farmer from Ledger after solving the block challenge.
     * Encode the block as binary and gossip over the network.
     */
    this.ledger.on('block', async (block: Block, encoding: Uint8Array) => {
      // console.log('New block received in node.');
      // console.log(`Encoding length is ${encoding.length}`);
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
  }

  /**
   * Looks for an existing address within the wallet, creating a new one if one does not exist.
   */
  public async getOrCreateAccount(): Promise<IWalletAccount> {
    const accounts = this.wallet.getAccounts();
    let account: IWalletAccount;
    accounts.length ? account = accounts[0] : account = await this.wallet.createAccount('test', 'A test account');
    return account;
  }

  /**
   * Tests the plotting workflow for some random data.
   */
  // public async plot(): Promise<void> {
  //   const data = crypto.randomBytes(520191);
  //   const paddedData = codes.padLevel(data);
  //   const encodedData = await codes.erasureCodeLevel(paddedData);
  //   const pieceSet = codes.sliceLevel(encodedData);
  //   await this.farm.seedPlot(this.address, pieceSet);
  //   console.log(`Completed plotting ${pieceSet.length} pieces.`);
  // }

  /**
   * Starts a new ledger from genesis and begins farming its own plot in isolation. Mostly for testing.
   * Retains both the original ledger data within storage and the encoded piece set in the plot.
   */
  public async createLedgerAndFarm(chainCount: number): Promise<void> {
    this.isFarming = true;
    const account = await this.getOrCreateAccount();
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
    while (this.isFarming) {
      await this.farmBlock();
    }
  }

  public async farmBlock(): Promise<void> {
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

  public async ping(nodeId: Uint8Array): Promise<void> {
    await this.rpc.ping(nodeId);
  }

  /**
   * A new tx is received over the network from another node.
   * Filter the tx for duplicates or spam. Validate the tx.
   * Apply the tx to the ledger and gossip to all other peers.
   */
  public async onTx(tx: Tx): Promise<void> {
    if (this.ledger.isValidTx(tx)) {
      const addresses = this.wallet.addresses;
      if (addresses.has(bin2Hex(tx.receiverAddress))) {
        this.wallet.onTxReceived(tx);
      }
      this.ledger.applyTx(tx);
      this.rpc.gossipTx(tx);
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
