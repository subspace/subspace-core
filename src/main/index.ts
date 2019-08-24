// tslint:disable: no-console
import { Node } from '../node/node';

const run = async () => {
  const node = await Node.init('rocks', 'mem-db');
  await node.getOrCreateAddress();

  if (node.address) {
    console.log(Buffer.from(node.address).toString('hex'));
  }
  // for (let i = 0; i < 1; ++i) {
  //   node.plot();
  // }
};

run();
