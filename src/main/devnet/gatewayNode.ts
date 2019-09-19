// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

import * as os from 'os';
import run from '../run';
import { chainCount, encodingRounds } from './constants';

const startGatewayNode = async () => {

  await run(
    'dev',
    'full',
    chainCount,
    'disk',
    1,
    100000000,
    true,
    true,
    encodingRounds,
    `${os.tmpdir()}/gateway`,
    1000,
    true,
    true,
    undefined,
    [],
  );
};

startGatewayNode();
