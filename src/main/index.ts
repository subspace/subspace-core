// tslint:disable: no-console
// tslint:disable: object-literal-sort-keys

import * as crypto from '../crypto/crypto';
import { INodeContactInfo } from '../network/INetwork';
import {run} from "./run";

/**
 * Default Args for Browser Build
 *
 * Full Node
 * 128 chains
 * Disk based plotting
 * 1024 plots
 * 1 GB Plot
 * Validation
 * 3 rounds of piece encoding
 * Storage Path (optional)
 */

// module.exports = run;

// const gatewayNodeId = crypto.hash(Buffer.from('gateway'));

// // spin up the gateway node
// const gatewayContactInfo: INodeContactInfo = {
//   nodeId: gatewayNodeId,
//   nodeType: 'gateway',
//   address: 'localhost',
//   udp4Port: 10888,
//   tcp4Port: 10889,
//   wsPort: 10890,
// };

const browserNodeId = crypto.hash(Buffer.from('browser-validator'));

// spin up the validator node
const browserContactInfo: INodeContactInfo = {
  nodeId: browserNodeId,
  nodeType: 'validator',
  address: 'localhost',
  udp4Port: undefined,
  tcp4Port: undefined,
  wsPort: undefined,
};

// const awsGatewayNodeId = crypto.hash(Buffer.from('aws-gateway'));

// // spin up the gateway node
// const awsGatewayContactInfo: INodeContactInfo = {
//   nodeId: awsGatewayNodeId,
//   nodeType: 'gateway',
//   address: 'ec2-54-191-145-133.us-west-2.compute.amazonaws.com',
//   udp4Port: 11888,
//   tcp4Port: 11889,
//   wsPort: 11890,
// };

const localGatewayNodeId = crypto.hash(Buffer.from('local-gateway'));

// spin up the gateway node
const localGatewayContactInfo: INodeContactInfo = {
  nodeId: localGatewayNodeId,
  nodeType: 'gateway',
  address: 'localhost',
  udp4Port: 10888,
  tcp4Port: 10889,
  wsPort: 10890,
};

module.exports = run(
  'validator',
  16,
  'memory',
  0,
  0,
  true,
  3,
  undefined,
  0,
  true,
  true,
  browserContactInfo,
  [localGatewayContactInfo],
  );
