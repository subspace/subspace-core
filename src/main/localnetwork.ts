// tslint:disable: object-literal-sort-keys

import { Node } from '../node/node';
import { IPeerContactInfo } from "./interfaces";
import { run } from './run';

// may need to add a delay to allow sync to occur (slow it down)

/**
 * Step one: test that validator receives and validates new blocks from gateway
 * Step two: test that validator can start farming and we don't fork the chain or levels
 * Step three: test that a new farmer can join, sync the ledger manually, and start farming
 * Step four: test that a light client can join and sync state before validating new blocks
 */
const testLocalNetwork = async () => {

  const chainCount = 1;

  // spin up the gateway node
  const gatewayContactInfo: IPeerContactInfo = {
    nodeId: new Uint8Array(),
    nodeType: 'gateway',
    address: 'localhost',
    udp4Port: 10888,
    tcp4Port: 10889,
    wsPort: 10890,
  };

  const gatewayNode: Node = await run(
    'full',
    1,
    'memory',
    1,
    100000000,
    true,
    3,
    undefined,
    true,
    gatewayContactInfo,
    [],
  );

  gatewayContactInfo.nodeId = gatewayNode.settings.contactInfo.nodeId;

  // spin up the validator node
  const validatorContactInfo: IPeerContactInfo = {
    nodeId: new Uint8Array(),
    nodeType: 'validator',
    address: 'localhost',
    udp4Port: 11888,
    tcp4Port: 11889,
    wsPort: 11890,
  };

  const validatorNode: Node = await run(
    'validator',
    1,
    'memory',
    0,
    0,
    true,
    3,
    undefined,
    true,
    validatorContactInfo,
    [gatewayContactInfo],
  );

  validatorContactInfo.nodeId = validatorNode.settings.contactInfo.nodeId;

  // start farming from genesis on the gateway node, validator should receive blocks via gossip and validate to true
  gatewayNode.createLedgerAndFarm(chainCount);
};

testLocalNetwork();
