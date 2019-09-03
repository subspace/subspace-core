// tslint:disable: no-console
import * as commander from "commander";
import * as fs from "fs";
import { Node } from '../node/node';

const version = JSON.parse(fs.readFileSync(__dirname + '/../../package.json', 'utf8')).version;
// const title = `Subspace Network Daemon version ${version}`;

const program = new commander.Command();

program
  .command('run')
  .action(async () => {
    const node = await Node.init('rocks', 'mem-db', true);
    await node.getOrCreateAddress();
    if (node.wallet.address) {
      const address = Buffer.from(node.wallet.address).toString('hex');
      console.log(`Created new node with address: ${address.substring(0, 8)}`);
    }
  });

program
    .version(version, '-v, --version')
    .parse(process.argv);
