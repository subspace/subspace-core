// tslint:disable: no-console

// import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { Farm } from '../farm/farm';
import { Block } from '../ledger/block';
import { Ledger } from '../ledger/ledger';
import { Proof } from '../ledger/proof';
import { Tx } from '../ledger/tx';
import { CHUNK_LENGTH, COINBASE_REWARD, PIECE_SIZE } from '../main/constants';
import { IBlockData, ITxData } from '../main/interfaces';
import { bin2Hex, measureProximity } from '../utils/utils';
import { IWalletAccount, Wallet } from '../wallet/wallet';

// ToDo
  // detect type of storage for storage adapter
  // define the full API
  // include the RPC interface
  // sync an existing ledger

// Descriptive Console Output
  //

export class Node {

  /**
   * Instantiate a new empty node with only environment variables.
   */
  public static async init(storageAdapter = 'rocks', mode: typeof Farm.MODE_MEM_DB | typeof Farm.MODE_DISK_DB = 'mem-db', validateRecords: boolean): Promise<Node> {
    const wallet = await Wallet.open(storageAdapter);
    const farm = await Farm.init(storageAdapter, mode);
    const ledger = await Ledger.init(storageAdapter, validateRecords);
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
      return;
      // include the referenced encoding
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

    // `this.rpc` is undefined
    return;
    /**
     * A new block is received over the network from another farmer.
     * Filter the block for duplicates or spam. Validate the block.
     * Apply the block to the ledger and gossip to all other peers.
     */
    this.rpc.on('block', (blockData: IBlockData, encoding: Uint8Array) => {
      return;
      // should include the encoding
      // filter
      // validate
      // apply
      // re-gossip
      const block = Block.load(blockData);
      if (this.ledger.isValidBlock(block, encoding)) {
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
      // filter
      // validate
      // apply
      // re-gossip
      // check for account updates for this node
      const tx = Tx.load(txData);
      if (this.ledger.isValidTx(tx)) {
        const addresses = this.wallet.addresses;
        if (addresses.has(bin2Hex(tx.receiverAddress))) {
          this.wallet.onTxReceived(tx);
        }
        this.ledger.applyTx(tx);
        this.rpc.gossip(txData);
      }
    });
  }

  /**
   * Looks for an existing address within the wallet, creating a new one if one does not exist.
   */
  public async getOrCreateAccount(): Promise<IWalletAccount> {
    const accounts = this.wallet.getAccounts();
    let account: IWalletAccount;
    accounts.length ? account = accounts[0] : account = await this.wallet.createAccount('test', 'A test account');
    this.farm.address = account.address;
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
      // find best encoding for challenge
      console.log('\nSolving a new block challenge');
      console.log('------------------------------');
      console.log(`State: ${this.ledger.stateMap.size} levels`);
      console.log(`Ledger; ${this.ledger.compactBlockMap.size} blocks`);
      const piecesInPlot = this.farm.getSize();
      const plotSize = (piecesInPlot * PIECE_SIZE) / 1000000;
      console.log(`Plot: ${piecesInPlot} pieces comprising ${plotSize} MB`);
      console.log(`Balance: ${this.ledger.accounts.get(this.farm.address)} credits`);
      console.log('------------------------------\n');

      const previousLevelHash = this.ledger.previousLevelHash;
      const parentProofHash = this.ledger.parentProofHash;
      const seed = Buffer.concat([previousLevelHash, parentProofHash]);
      const pieceTarget = crypto.hash(seed);
      const closestEncoding = await this.farm.getClosestEncoding(pieceTarget);
      if (!closestEncoding) {
        throw new Error('Cannot find a piece within plot for target');
      }
      const encoding = closestEncoding.encoding;
      console.log(`Closest piece to target: ${bin2Hex(pieceTarget).substr(0, 16)} is ${bin2Hex(closestEncoding.data.pieceHash).substring(0, 16)}`);
      let bestChunkQuality = 0;
      let bestChunk = new Uint8Array();
      const chunkTarget = crypto.hash(pieceTarget).subarray(0, 8);

      // find best chunk for challenge
      for (let i = 0; i < PIECE_SIZE / CHUNK_LENGTH; ++i) {
        const chunk = encoding.subarray(i * CHUNK_LENGTH, (i + 1) * CHUNK_LENGTH);
        const quality = measureProximity(chunk, chunkTarget);
        if (quality > bestChunkQuality) {
          bestChunkQuality = quality;
          bestChunk = chunk;
        }
      }

      console.log(`Closest chunk to target: ${bin2Hex(chunkTarget)} is ${bin2Hex(bestChunk)}`);

      const account = this.wallet.getAccount(this.farm.address);

      // create proof of storage
      const unsignedProof = await Proof.create(
        previousLevelHash,
        parentProofHash,
        bestChunk,
        closestEncoding.data.pieceHash,
        closestEncoding.data.stateHash,
        closestEncoding.data.proof,
        account.publicKey,
      );
      const signedProof = this.wallet.signProof(unsignedProof);

      // create coinbase tx
      const coinbaseTx = await this.wallet.createCoinBaseTx(COINBASE_REWARD, account.publicKey);

      // const block =
      await this.ledger.createBlock(signedProof, coinbaseTx, encoding);

      // print(block.print());
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
