// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

import * as os from 'os';
import run from '../run';
import { chainCount, encodingRounds } from './constants';

const testFarmerNode = async () => {

  await run(
    'dev',
    'farmer',
    chainCount,
    'disk',
    1,
    1000000000,
    false,
    true,
    encodingRounds,
    `${os.tmpdir()}/farmer`,
    1000,
    true,
    true,
    undefined,
    [],
  );
};

testFarmerNode();
