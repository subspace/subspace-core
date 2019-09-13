// tslint:disable: object-literal-sort-keys
// tslint:disable: no-console

import * as os from 'os';
import * as crypto from '../../crypto/crypto';
// import { Node } from '../../node/node';
import { IPeerContactInfo } from "../interfaces";
import { run } from '../run';

const pingTest = async () => {

  // spin up the gateway node
  const gatewayNodeId = crypto.hash(Buffer.from('gateway'));
  const gatewayContactInfo: IPeerContactInfo = {
    nodeId: gatewayNodeId,
    address: 'localhost',
    udpPort: 10888,
    tcpPort: 10889,
    wsPort: 10890,
    protocolVersion: '4',
  };

  // spin up the validator node
  const validatorNodeId = crypto.hash(Buffer.from('validator'));
  const validatorContactInfo: IPeerContactInfo = {
    nodeId: validatorNodeId,
    address: 'localhost',
    udpPort: 11888,
    tcpPort: 11889,
    wsPort: 11890,
    protocolVersion: '4',
  };

  // const gatewayNode: Node = await
  run(
    'full',
    1,
    'disk',
    1,
    10000000,
    true,
    3,
    `${os.tmpdir()}/gateway`,
    true,
    gatewayContactInfo,
    [validatorContactInfo],
  );

  // const validatorNode: Node = await
  run(
    'validator',
    1,
    'disk',
    0,
    0,
    true,
    3,
    `${os.tmpdir()}/validator`,
    true,
    validatorContactInfo,
    [gatewayContactInfo],
  );

  // await gatewayNode.ping(validatorNodeId);
  // const payload = crypto.randomBytes(32);
  // console.log('sending ping request to gateway', payload);
  // await validatorNode.ping(gatewayNodeId, payload);
  // console.log('pong reply received by validator', payload);

};

pingTest();
