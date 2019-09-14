// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

import * as os from 'os';
import * as crypto from '../../crypto/crypto';
import { INodeContactInfo } from '../../network/INetwork';
import { Node } from '../../node/node';
import { run } from '../run';

/**
 * Step one: test that validator receives and validates new blocks from gateway
 * Step two: test that validator can start farming and we don't fork the chain or levels
 * Step three: test that a new farmer can join, sync the ledger manually, and start farming
 * Step four: test that a light client can join and sync state before validating new blocks
 */
const startGatewayNode = async () => {

  const gatewayNodeId = crypto.hash(Buffer.from('gateway'));

  // spin up the gateway node
  const gatewayContactInfo: INodeContactInfo = {
    nodeId: gatewayNodeId,
    nodeType: 'gateway',
    address: 'localhost',
    udp4Port: 10888,
    tcp4Port: 10889,
    wsPort: 10890,
  };

  const gatewayNode: Node = await run(
    'full',
    1,
    'disk',
    1,
    100000000,
    true,
    3,
    `${os.tmpdir()}/gateway`,
    100,
    false,
    false,
    gatewayContactInfo,
    [],
  );

  setTimeout(() => {
    gatewayNode.createLedgerAndFarm();
  }, 10000);

};

startGatewayNode();
