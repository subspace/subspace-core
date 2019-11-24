import { NodeManagerJsUint8Array, Tree } from "@subspace/red-black-tree";
import * as crypto from '../crypto/crypto';
import { areArraysEqual, num2Bin } from '../utils/utils';

// Chia proof of space
    // start by iterating an index x over a table size of i
    // compute x(i) as hash(seed||i) or y
    // sort all y in order
    // test each y to see if two are adjacent
    // when two are found, hash them together to determine z
    // add z to the BST, with x and x'

export class MemoryProof {
    private readonly memTree: Tree<Uint8Array, number>;

    constructor() {
        const nodeManager = new NodeManagerJsUint8Array<number>();
        this.memTree = new Tree(nodeManager);
    }

    // fill the tree with hashes derived from a short seed
    public buildTree(seed: Uint8Array, size: number): void {
        for (let i = 0; i < size; ++i) {
            const key = crypto.hash(Buffer.concat([seed, num2Bin(i)]));
            this.memTree.addNode(key, i);
        }
    }

    // get the index (input) for the closest hash to a challenge
    public getProof(challenge: Uint8Array): [Uint8Array, number] {
        const node = this.memTree.getClosestNode(challenge);
        if (!node) {
            throw new Error('Cannot return index for an empty mem tree');
        }
        return node;
    }

    // verify that a proof was derived from the given seed and index
    public verifyProof(seed: Uint8Array, index: number, proof: Uint8Array): boolean {
        return areArraysEqual(proof, crypto.hash(Buffer.concat([seed, num2Bin(index)])));
    }

}
