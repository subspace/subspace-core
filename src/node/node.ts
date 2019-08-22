// tslint:disable: no-console

import * as codes from '../codes/codes';
import * as crypto from '../crypto/crypto';
import { Farm } from '../farm/farm';
import { Ledger } from '../ledger/ledger';
import { Network } from '../network/network';
import * as utils from '../utils/utils';
import { Wallet } from '../wallet/wallet';

// ToDo
  // start ledger
  // compose in node
  // run from CLI with commander
  // run in browser with index.html
  // basic UDP network

export class Node {

  public static async init(storageAdapter = 'rocks', mode: typeof Farm.MODE_MEM_DB | typeof Farm.MODE_DISK_DB): Promise<Node> {
    const wallet = await Wallet.init(storageAdapter);
    const farm = await Farm.init(storageAdapter, mode);
    return new Node(wallet, farm);
  }

  public id: Uint8Array;
  public wallet: Wallet;
  public farm: Farm;
  public network: Network = new Network();
  // public ledger: Ledger;

  constructor(wallet: Wallet, farm: Farm) {
    this.wallet = wallet;
    this.farm = farm;
    this.id = new Uint8Array();
  }

  public async createId(): Promise<void> {
    const seed = crypto.randomBytes(32);
    const address = await this.wallet.createKeyPair(seed);
    this.id = address;
  }

  public async plot(): Promise<void> {
    const data = crypto.randomBytes(520191);
    const paddedData = codes.padLevel(data);
    const encodedData = codes.erasureCodeLevel(paddedData);
    const pieceSet = codes.sliceLevel(encodedData);
    await this.farm.initPlot(this.id, pieceSet);
    console.log(`Completed plotting ${pieceSet.length} pieces.`);
  }
}
