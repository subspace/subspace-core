// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

import * as os from 'os';
import { run } from '../run';
import { awsGatewayContactInfo, awsValidatorContactInfo, chainCount, encodingRounds } from './constants';

const startValidatorNode = async () => {

  await run(
    'validator',
    chainCount,
    'memory',
    0,
    0,
    true,
    encodingRounds,
    `${os.tmpdir()}/validator`,
    0,
    true,
    true,
    awsValidatorContactInfo,
    [awsGatewayContactInfo],
  );
};

startValidatorNode();
