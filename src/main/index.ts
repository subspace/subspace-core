// tslint:disable: no-console
import { Node } from '../node/node';

const run = async () => {
  const node = await Node.init('rocks', 'mem-db');
  await node.getOrCreateAddress();
};

run();
