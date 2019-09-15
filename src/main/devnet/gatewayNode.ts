// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

import * as os from 'os';
import { run } from '../run';
import { chainCount, encodingRounds, gatewayContactInfo } from './constants';

const startGatewayNode = async () => {

  await run(
    'full',
    chainCount,
    'disk',
    100,
    100000000,
    true,
    encodingRounds,
    `${os.tmpdir()}/gateway`,
    100,
    false,
    false,
    gatewayContactInfo,
    [],
  );
};

startGatewayNode();
