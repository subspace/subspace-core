// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

import * as os from 'os';
import { run } from '../run';
import { chainCount, encodingRounds, farmerContactInfo, gatewayContactInfo } from './constants';

const testFarmerNode = async () => {

  await run(
    'farmer',
    chainCount,
    'disk',
    1,
    1000000000,
    true,
    encodingRounds,
    `${os.tmpdir()}/farmer`,
    100,
    true,
    true,
    farmerContactInfo,
    [gatewayContactInfo],
  );
};

testFarmerNode();
