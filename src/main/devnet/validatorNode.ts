// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

import * as os from 'os';
import { run } from '../run';
import { chainCount, encodingRounds, gatewayContactInfo, validatorContactInfo } from './constants';

const testValidatorNode = async () => {

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
    false,
    true,
    validatorContactInfo,
    [gatewayContactInfo],
  );
};

testValidatorNode();
