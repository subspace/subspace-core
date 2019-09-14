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

  const awsGatewayNodeId = crypto.hash(Buffer.from('aws-gateway'));

  // spin up the gateway node
  const awsGatewayContactInfo: INodeContactInfo = {
    nodeId: awsGatewayNodeId,
    nodeType: 'gateway',
    address: '54.191.145.133',
    udp4Port: 10888,
    tcp4Port: 10889,
    wsPort: 10890,
  };

  // const validatorNodeId = crypto.hash(Buffer.from('validator'));

  // // spin up the validator node
  // const validatorContactInfo: INodeContactInfo = {
  //   nodeId: validatorNodeId,
  //   address: 'localhost',
  //   nodeType: 'validator',
  //   udp4Port: 11888,
  //   tcp4Port: 11889,
  //   wsPort: 11890,
  // };

  // const validator2NodeId = crypto.hash(Buffer.from('validator2'));
  // // spin up the validator node
  // const validator2ContactInfo: INodeContactInfo = {
  //   nodeId: validator2NodeId,
  //   nodeType: 'validator',
  //   address: 'localhost',
  //   udp4Port: 13888,
  //   tcp4Port: 13889,
  //   wsPort: 13890,
  // };

  const gatewayNode: Node = await run(
    'full',
    1,
    'memory',
    1,
    100000000,
    true,
    3,
    `${os.tmpdir()}/gateway`,
    100,
    false,
    false,
    awsGatewayContactInfo,
    [],
  );

  setTimeout(() => {
    gatewayNode.createLedgerAndFarm();
  }, 10000);

};

startGatewayNode();
