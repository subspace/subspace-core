// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

import * as os from 'os';
import * as crypto from '../../crypto/crypto';
import {INodeContactInfo} from "../../network/Network";
import { run } from '../run';

/**
 * Step one: test that validator receives and validates new blocks from gateway
 * Step two: test that validator can start farming and we don't fork the chain or levels
 * Step three: test that a new farmer can join, sync the ledger manually, and start farming
 * Step four: test that a light client can join and sync state before validating new blocks
 */
const startGatewayNode = async () => {

  const awsGatewayNodeId = crypto.hash(Buffer.from('aws-gateway'));

  // spin up the gateway node
  const awsGatewayContactInfo: INodeContactInfo = {
    nodeId: awsGatewayNodeId,
    nodeType: 'gateway',
    address: 'ec2-54-191-145-133.us-west-2.compute.amazonaws.com',
    udp4Port: 11888,
    tcp4Port: 11889,
    wsPort: 11890,
  };

  await run(
    'full',
    1,
    'disk',
    1,
    100000000,
    true,
    3,
    `${os.tmpdir()}/gateway`,
    1000,
    true,
    true,
    awsGatewayContactInfo,
    [],
  );
};

startGatewayNode();
