// tslint:disable: object-literal-sort-keys
import * as crypto from '../../crypto/crypto';
import { INodeContactInfo } from '../../network/INetwork';

export const chainCount = 16;
export const encodingRounds = 3;

export const gatewayContactInfo: INodeContactInfo = {
  nodeId: crypto.hash(Buffer.from('gateway')),
  nodeType: 'gateway',
  address: 'localhost',
  udp4Port: 10888,
  tcp4Port: 10889,
  wsPort: 10890,
};

export const validatorContactInfo: INodeContactInfo = {
  nodeId: crypto.hash(Buffer.from('validator')),
  address: 'localhost',
  nodeType: 'validator',
  udp4Port: 11888,
  tcp4Port: 11889,
  wsPort: 11890,
};

export const farmerContactInfo: INodeContactInfo = {
  nodeId: crypto.hash(Buffer.from('farmer')),
  address: 'localhost',
  nodeType: 'farmer',
  udp4Port: 12888,
  tcp4Port: 12889,
  wsPort: 12890,
};
