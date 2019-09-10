// tslint:disable: object-literal-sort-keys

import { Node } from '../node/node';
import { IPeerContactInfo } from "./interfaces";

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
    address: 'localhost',
    udpPort: 10888,
    tcpPort: 10889,
    wsPort: 10890,
    protocolVersion: '4',
  };

  const gatewayNode = await Node.init(
    gatewayContactInfo,
    [],
    'full',
    'memory',
    'mem-db',
    1,
    100000000,
    true,
    3,
  );

  const gatewayAccount = await gatewayNode.getOrCreateAccount();
  gatewayContactInfo.nodeId = gatewayAccount.address;

  // spin up the validator node
  const validatorContactInfo: IPeerContactInfo = {
    nodeId: new Uint8Array(),
    address: 'localhost',
    udpPort: 11888,
    tcpPort: 11889,
    wsPort: 11890,
    protocolVersion: '4',
  };

  const validatorNode = await Node.init(
    validatorContactInfo,
    [gatewayContactInfo],
    'validator',
    'memory',
    undefined,
    0,
    0,
    true,
    3,
  );

  const validatorAccount = await validatorNode.getOrCreateAccount();
  validatorContactInfo.nodeId = validatorAccount.address;

  // start farming from genesis on the gateway node, validator should receive blocks via gossip and validate to true
  gatewayNode.createLedgerAndFarm(chainCount);
};

testLocalNetwork();
