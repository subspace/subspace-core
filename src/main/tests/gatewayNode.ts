// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

import * as os from 'os';
import * as crypto from '../../crypto/crypto';
import { Node } from '../../node/node';
import { IPeerContactInfo } from "../interfaces";
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
  const gatewayContactInfo: IPeerContactInfo = {
    nodeId: gatewayNodeId,
    nodeType: 'gateway',
    address: 'localhost',
    udpPort: 10888,
    tcpPort: 10889,
    wsPort: 10890,
    protocolVersion: '4',
  };

  const validatorNodeId = crypto.hash(Buffer.from('validator'));

  // spin up the validator node
  const validatorContactInfo: IPeerContactInfo = {
    nodeId: validatorNodeId,
    address: 'localhost',
    nodeType: 'validator',
    udpPort: 11888,
    tcpPort: 11889,
    wsPort: 11890,
    protocolVersion: '4',
  };

  const gatewayNode: Node = await run(
    'full',
    32,
    'memory',
    1,
    100000000,
    true,
    3,
    `${os.tmpdir()}/gateway`,
    true,
    gatewayContactInfo,
    [validatorContactInfo],
  );

  setTimeout(() => {
    gatewayNode.createLedgerAndFarm();
  }, 5000);

};

startGatewayNode();
