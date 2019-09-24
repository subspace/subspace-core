// tslint:disable:object-literal-sort-keys
import {NODE_ID_LENGTH} from "../main/constants";

export const COMMANDS = {
  'response': 0,
  'identification': 1,
  'gossip': 2,
  'tx-gossip': 10,
  'block-gossip': 11,
  'ping': 12,
  'pong': 13,
  'tx-request': 14,
  'block-request': 15,
  'block-request-by-index': 16,
  'piece-request': 17,
  'proof-request': 18,
  'content-request': 19,
  'state-request': 20,
  'state-request-by-index': 21,
};
// tslint:enable:object-literal-sort-keys

export type ICommandsKeys = keyof typeof COMMANDS;
export type ICommandsKeysForSending = keyof Omit<Omit<Omit<typeof COMMANDS, 'gossip'>, 'response'>, 'identification'>;

export const COMMANDS_INVERSE: { [commandNumber: number]: ICommandsKeys } = {};
// tslint:disable-next-line:forin
for (const command in COMMANDS) {
  COMMANDS_INVERSE[COMMANDS[command as ICommandsKeys]] = command as ICommandsKeys;
}

export const GOSSIP_COMMANDS_SET = new Set<ICommandsKeys>([
  'tx-gossip',
  'block-gossip',
]);

// tslint:disable:object-literal-sort-keys
export const NODE_TYPES = {
  any: 0,
  full: 1,
  validator: 2,
  farmer: 3,
  gateway: 4,
  client: 5,
};
// tslint:enable:object-literal-sort-keys

export type INodeTypesKeys = keyof typeof NODE_TYPES;

export const NODE_TYPES_INVERSE: { [nodeTypeNumber: number]: INodeTypesKeys } = {};

// tslint:disable-next-line:forin
for (const nodeType in NODE_TYPES) {
  NODE_TYPES_INVERSE[NODE_TYPES[nodeType as INodeTypesKeys]] = nodeType as INodeTypesKeys;
}

// Node type + node ID
export const IDENTIFICATION_PAYLOAD_LENGTH = 1 + NODE_ID_LENGTH;
// 3 ports 2 bytes each + 64 bytes for node address (IP or domain name)
export const ADDRESS_PAYLOAD_LENGTH = 2 + 2 + 2 + 64;

export const EXTENDED_IDENTIFICATION_PAYLOAD_LENGTH = IDENTIFICATION_PAYLOAD_LENGTH + ADDRESS_PAYLOAD_LENGTH;
