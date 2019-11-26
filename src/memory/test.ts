// tslint:disable: no-console

import * as crypto from '../crypto/crypto';
import { bin2Hex, bin2Num, measureProximity } from '../utils/utils';
import { DiskProof } from './diskProof';
import { MemoryProof } from './memProof';

async function run(): Promise<void> {

    // setup
    const ROUNDS = 16;
    const memProof = new MemoryProof();
    const seed = crypto.randomBytes(32);
    const size = 256000;
    let memoryAggregateQuality = 0;
    memProof.buildTree(seed, size);

    const diskProof = new DiskProof();
    await diskProof.buildTree(seed, size);
    let diskAggregateQuality = 0;

    for (let r = 0; r < ROUNDS; ++r) {

        // challenge / response
        const challenge = crypto.randomBytes(32);
        const proof = memProof.getProof(challenge);
        const quality = measureProximity(challenge, proof[0]);
        memoryAggregateQuality += quality;

        console.log(`Best memory proof for challenge ${bin2Hex(challenge).substring(0, 12)} is ${bin2Hex(proof[0]).substring(0, 12)} at index ${proof[1]} with quality ${quality}`);

        // verification
        const isValid = memProof.verifyProof(seed, proof[1], proof[0]);
        if (!isValid) {
            console.log('Invalid proof');
        }
    }

    for (let r = 0; r < ROUNDS; ++r) {

        const challenge = crypto.randomBytes(32);
        const proof = await diskProof.getProof(challenge);
        const quality = measureProximity(challenge, proof[0]);
        diskAggregateQuality += quality;

        console.log(`Best disk proof for challenge ${bin2Hex(challenge).substring(0, 12)} is ${bin2Hex(proof[0]).substring(0, 12)} at index ${bin2Num(proof[1])} with quality ${quality}`);

        // verification
        const isValid = diskProof.verifyProof(seed, proof[1], proof[0]);
        if (!isValid) {
            console.log('Invalid disk proof');
        }
    }

    const memoryAverageQuality = memoryAggregateQuality / ROUNDS;
    console.log(`\nAverage quality for memory tree is ${memoryAverageQuality} over ${ROUNDS} rounds.`);

    const diskAverageQuality = diskAggregateQuality / ROUNDS;
    console.log(`\nAverage quality for disk tree is ${diskAverageQuality} over ${ROUNDS} rounds.`);
}

run();
