// tslint:disable: no-console
import * as commander from "commander";
import * as fs from "fs";
import { run } from './run';

const version = JSON.parse(fs.readFileSync(__dirname + '/../../package.json', 'utf8')).version;
// const title = `Subspace Network Daemon (SND) CLI version ${version}`

const program = new commander.Command();

program
  .command('run')
  .description('Start a new node for the Subspace Protocol')
  .option('-m, --mode <mode>', 'mode to operate node (full, farmer, validator, client', 'full')
  .option('-c, --chains <chains>', 'number of chains in the ledger', 1)
  .option('-f, --farm <farm>', 'mode to operate farm (memory, disk)', 'disk')
  .option('-p, --plots <plots>', 'number of plots in the farm', 1)
  .option('-s, --size <size>', 'size of farm in bytes', 10000000000)
  .option('-a, --validate <validate>', 'if to validate records (t/f)', false)
  .option('-e, --encoding <encoding>', 'number of rounds for piece encoding/decoding', 3)
  .option('-d, --directory <directory>', 'directory for persistent storage and plotting', null)
  .option('-w, --wait <wait>', 'a mean random delay time for farming', 0)
  .action((args) => {
    run(
      args.mode,
      args.chains,
      args.farm,
      args.plots,
      args.size,
      args.validate,
      args.encoding,
      args.directory,
      args.wait,
    );
  });

program
    .version(version, '-v, --version')
    .parse(process.argv);
