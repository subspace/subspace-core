// tslint:disable: no-console

if (!globalThis.indexedDB) {
  // Only import when not preset (in Node.js)
  // tslint:disable-next-line:no-var-requires no-submodule-imports
  require('fake-indexeddb/auto');
}

import { Node } from '../node/node';

/**
 * Optional Init Params
 * chainCount (1 to 1024)
 * nodeMode (full node, farmer, validator, light client)
 * plotMode (memory, disk, raw memory, raw disk, on the fly)
 * plotDifficulty (encoding rounds)
 * storagePath (location for disk based storage)
 * seed (for public key)
 */
const run = async () => {
  const node = await Node.init(
    // Use `memory` for Node.js for now
    typeof globalThis.document ? 'memory' : 'rocks',
    'mem-db',
  );
  await node.getOrCreateAddress();
  await node.createLedgerAndFarm(1);
};

run();
