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
const startValidatorNode = async () => {

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

  const validatorNodeId = crypto.hash(Buffer.from('validator'));

  // spin up the validator node
  const validatorContactInfo: INodeContactInfo = {
    nodeId: validatorNodeId,
    address: 'localhost',
    nodeType: 'validator',
    udp4Port: 12888,
    tcp4Port: 12889,
    wsPort: 12890,
  };

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

  const validatorNode: Node = await run(
    'validator',
    1,
    'memory',
    0,
    0,
    true,
    3,
    `${os.tmpdir()}/validator`,
    1000,
    false,
    false,
    validatorContactInfo,
    [awsGatewayContactInfo],
  );

  validatorNode.ping();
  validatorNode.syncLedgerAndValidate();

};

startValidatorNode();
