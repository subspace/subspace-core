// tslint:disable: no-console
import * as program from "commander";
import * as fs from "fs";
import { Node } from '../node/node';

const version = JSON.parse(fs.readFileSync(__dirname + '/../package.json', 'utf8')).version;
const title = `Subspace Network Daemon version ${version}`;

program
  .command('run')
  .action(async () => {
    const node = await Node.init('rocks', 'mem-db');
    await node.createId();
    if (node.id) {
      const id = Buffer.from(node.id).toString('hex');
      console.log(`Created new node with id: ${id.substring(0, 8)}`);
    }
  });

program
    .version(version, '-v, --version')
    .parse(process.argv);
