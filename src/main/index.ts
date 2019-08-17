// tslint:disable: no-console
import { Node } from '../node/node';

const run = async () => {
  const node = await Node.init('rocks', 'disk-db');
  await node.createId();

  if (node.id) {
    console.log(Buffer.from(node.id).toString('hex'));
  }
  for (let i = 0; i < 1; ++i) {
    node.plot();
  }
};

run();
