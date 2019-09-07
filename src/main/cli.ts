// tslint:disable: no-console
import * as commander from "commander";
import * as fs from "fs";
import { run } from '../main/index';
// import { Node } from '../node/node';

const version = JSON.parse(fs.readFileSync(__dirname + '/../../package.json', 'utf8')).version;
// const title = `Subspace Network Daemon (SND) CLI version ${version}`

const program = new commander.Command();

program
  .command('run')
  .description('Start a new node for the Subspace Protocol')
  .action((args) => {
    run(
      args.mode ? args.mode : 'full',
      args.chains ? args.chains : 1,
      args.farm ? args.farm : 'disk',
      args.plots ? args.plots : 100,
      args.size ? args.size : 10000000000,
      args.validate ? args.validate : false,
      args.encoding ? args.encoding : 3,
      args.directory ? args.directory : null,
    );
  })
  .option('-m, --mode', 'mode to operate node (full, farmer, validator, client')
  .option('-c, --chains', 'number of chains in the ledger')
  .option('-f, --farm', 'mode to operate farm (memory, disk)')
  .option('-p, --plots', 'number of plots in the farm')
  .option('-s, --size', 'size of farm in bytes')
  .option('-v, --validate', 'if to validate records (t/f)')
  .option('-e, --encoding', 'number of rounds for piece encoding/decoding')
  .option('-d, --directory', 'directory for persistent storage and plotting');

program
    .version(version, '-v, --version')
    .parse(process.argv);
