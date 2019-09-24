// tslint:disable: no-console
import * as commander from "commander";
import * as fs from "fs";
import run from './run';

const version = JSON.parse(fs.readFileSync(__dirname + '/../../package.json', 'utf8')).version;
// const title = `Subspace Network Daemon (SND) CLI version ${version}`

const program = new commander.Command();

// type args
  // -n network: 'dev'
  // -m mode: 'full'
  // -f farm: 'disk'
  // -d directory must incorporate node id

// integer args
  // -c chains: 32
  // -p plots   1
  // -s size    1000000
  // -e rounds  3
  // -w wait    300

// boolean args
  // -g genesis: sets from genesis to true  false
  // -r reset: sets reset flag to true      false
  // -t trusted: sets validate to false     false

program
  .command('run')
  .description('Start a new node for the Subspace Protocol')

  // optional string args
  .option('-n, --network <network>', 'network to connect to or create (dev, test, main', 'dev')
  .option('-m, --mode <mode>', 'mode to operate node (full, farmer, validator, client', 'full')
  .option('-f, --farm <farm>', 'mode to operate farm (memory, disk)', 'disk')
  .option('-d, --directory <directory>', 'directory for persistent storage and plotting', undefined)

  // optional numeric args
  .option('-c, --chains <chains>', 'number of chains in the ledger', 1)
  .option('-p, --plots <plots>', 'number of plots in the farm', 1)
  .option('-s, --size <size>', 'size of farm in bytes', 10000000000)
  .option('-e, --encoding <encoding>', 'number of rounds for piece encoding/decoding', 3)
  .option('-w, --wait <wait>', 'a mean random delay time for farming', 0)

  // optional boolean args (otherwise false)
  .option('-g, --genesis', 'if to start from genesis (sets to true)')
  .option('-r, --reset', 'if to erase all persisted data on restart (sets to true)')
  .option('-t, --trust', 'if to trust the node and skip validation (sets to true')

  .action((args) => {
    run(
      args.network,
      args.mode,
      args.farm,
      args.directory,
      args.chains,
      args.plots,
      args.size,
      args.encoding,
      args.wait,
      args.genesis,
      args.reset,
      args.trust,
      undefined,
      [],
    );
  });

program
    .version(version, '-v, --version')
    .parse(process.argv);
