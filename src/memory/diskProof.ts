import {NodeManagerBinaryDisk, TreeAsync} from "@subspace/red-black-tree";
import * as crypto from '../crypto/crypto';
import { areArraysEqual, num2Bin } from '../utils/utils';

export class DiskProof {
    private diskTree!: TreeAsync<Uint8Array, Uint8Array>;
    private nodeManager!: NodeManagerBinaryDisk;

    public async buildTree(seed: Uint8Array, size: number): Promise<void> {
        this.nodeManager = await NodeManagerBinaryDisk.create('/tree.bin', size, 32, 4);
        this.diskTree = new TreeAsync(this.nodeManager);
        for (let i = 0; i < size; ++i) {
            const key = crypto.hash(Buffer.concat([seed, num2Bin(i)]));
            this.diskTree.addNode(key, num2Bin(i));
        }
    }

    public  async getProof(challenge: Uint8Array): Promise<[Uint8Array, Uint8Array]> {
        const node = await this.diskTree.getClosestNode(challenge);
        if (!node) {
            throw new Error('Cannot return index for empty disk tree');
        }
        return node;
    }

    public verifyProof(seed: Uint8Array, index: Uint8Array, proof: Uint8Array): boolean {
        return areArraysEqual(proof, crypto.hash(Buffer.concat([seed, index])));
    }

    public async loadTree(): Promise<void> {
        this.nodeManager = await NodeManagerBinaryDisk.open('/tree.bin', 1000, 32, 4);
        this.diskTree = new TreeAsync(this.nodeManager);
    }

    public async closeTree(): Promise<void> {
        await this.nodeManager.close();
    }
}
