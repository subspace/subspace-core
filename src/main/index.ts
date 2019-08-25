// tslint:disable: no-console
import { Node } from '../node/node';

const run = async () => {
  const node = await Node.init(
    // Use `memory` for Node.js for now
    typeof globalThis.document ? 'memory' : 'rocks',
    'mem-db',
  );
  await node.getOrCreateAddress();
};

run();
