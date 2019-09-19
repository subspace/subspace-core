// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

import * as os from 'os';
import run from '../run';
import { chainCount, encodingRounds } from './constants';

const startValidatorNode = async () => {

  await run(
    'test',
    'validator',
    chainCount,
    'memory',
    0,
    0,
    false,
    true,
    encodingRounds,
    `${os.tmpdir()}/validator`,
    0,
    true,
    true,
    undefined,
    [],
  );
};

startValidatorNode();
