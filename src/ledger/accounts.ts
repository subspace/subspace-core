// tslint:disable: no-console
import { bin2Hex } from '../utils/utils';

// ToDo
  // track nonce for each address
  // persist to disk
  // how big can this get in memory: 400 MB per 10M accounts

/**
 * Manages the credit balance of all accounts on the ledger.
 */
export class Account {

  private accounts: Map<Uint8Array, number>;

  constructor() {
    this.accounts = new Map();
  }

  /**
   * Updates the credit balance of an account, creating a new one if one does not exist.
   */
  public update(address: Uint8Array, amount: number): void {
    let balance = this.accounts.get(address);
    if (balance) {
      balance += amount;
      if (balance < 0) {
        throw new Error('Invalid account update, balance cannot be negative!');
      }
      this.accounts.set(address, balance);
    } else {
      this.accounts.set(address, amount);
    }
  }

  /**
   * Checks if an account exists within the ledger.
   */
  public has(address: Uint8Array): boolean {
    return this.accounts.has(address);
  }

  /**
   * Returns the credit balance of an account, if the account exists.
   */
  public get(address: Uint8Array): number | void {
    if (this.has(address)) {
      return this.accounts.get(address);
    }
  }

  /**
   * Returns the number of accounts recorded on the ledger.
   */
  public getNumberOfAccounts(): number {
    return this.accounts.size;
  }

  /**
   * Returns the total number of credits being tracked on the ledger.
   */
  public getSumOfBalances(): number {
    return [...this.accounts.values()]
      .reduce((sum, value) => sum + value);
  }

  /**
   * Prints the balance of all accounts, as account_address : account_balance.
   */
  public printBalanceOfAccounts(): void {
    [...this.accounts.entries()]
      .map((entry) => {
        console.log(`Account ${bin2Hex(entry[0])} has a balance of ${entry[1]} credits`);
      });
  }
}
