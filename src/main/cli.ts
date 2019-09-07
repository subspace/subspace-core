// tslint:disable: no-console
import * as commander from "commander";
import * as fs from "fs";
import { run } from '../main/index';
// import { Node } from '../node/node';

const version = JSON.parse(fs.readFileSync(__dirname + '/../../package.json', 'utf8')).version;
// const title = `Subspace Network Daemon (SND) CLI version ${version}`

const program = new commander.Command();

program
  .command('run <nodeMode> <chainCount> <farmMode> <plotCount> <farmSize> <validateRecords> <encodingRounds> <storageDirectory> <resetStorage>')
  .description('Start a new node for the Subspace Protocol')
  .action((
    nodeMode = 'full',
    chainCount = 1,
    farmMode = 'disk',
    plotCount = 100,
    farmSize = 1000000,
    validateRecords = true,
    encodingRounds = 3,
    storageDirectory,
    resetStorage = true,
  ) => {
     run(nodeMode, chainCount, farmMode, plotCount, farmSize, validateRecords, encodingRounds, storageDirectory, resetStorage);
  });

  // .option('-m, --mode', 'mode to operate node (full, farmer, validator, client')
  // .option('-c, --chains', 'number of chains in the ledger')
  // .option('-f, --farm', 'mode to operate farm (memory, disk)')
  // .option('-p, --plots', 'number of plots in the farm')
  // .option('-s, --size', 'size of farm in bytes')
  // .option('-v, --validate', 'if to validate records (t/f)')
  // .option('-e, --encoding', 'number of rounds for piece encoding/decoding')
  // .option('-d, --directory', 'directory for persistent storage and plotting');

program
    .version(version, '-v, --version')
    .parse(process.argv);
