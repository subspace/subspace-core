// tslint:disable: object-literal-sort-keys
import * as crypto from '../../crypto/crypto';
import { INodeContactInfo } from '../../network/INetwork';

export const chainCount = 1;
export const encodingRounds = 3;

export const awsGatewayContactInfo: INodeContactInfo = {
  nodeId: crypto.hash(Buffer.from('aws-gateway')),
  nodeType: 'gateway',
  address: 'ec2-54-191-145-133.us-west-2.compute.amazonaws.com',
  udp4Port: 11888,
  tcp4Port: 11889,
  wsPort: 11890,
};

export const awsValidatorContactInfo: INodeContactInfo = {
  nodeId: crypto.hash(Buffer.from('validator')),
  address: 'localhost',
  nodeType: 'validator',
  udp4Port: 12888,
  tcp4Port: 12889,
  wsPort: 12890,
};

export const awsFarmerContactInfo: INodeContactInfo = {
  nodeId: crypto.hash(Buffer.from('farmer')),
  address: 'localhost',
  nodeType: 'farmer',
  udp4Port: 13888,
  tcp4Port: 13889,
  wsPort: 13890,
};
