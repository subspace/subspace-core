// tslint:disable:object-literal-sort-keys
import {NODE_ID_LENGTH} from "../main/constants";

export const COMMANDS = {
  'response': 0,
  'identification': 1,
  'gossip': 2,
  'tx-gossip': 3,
  'block-gossip': 4,
  'ping': 5,
  'pong': 6,
  'tx-request': 7,
  'block-request': 8,
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
