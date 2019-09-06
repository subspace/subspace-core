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
    await Node.init('full', 'rocks', 'mem-db', 1, 1000000000, true, 3);
  });

program
    .version(version, '-v, --version')
    .parse(process.argv);
