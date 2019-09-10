// tslint:disable:object-literal-sort-keys
export const COMMANDS = {
  'response': 0,
  'identification': 1,
  'ping': 2,
  'pong': 3,
  'tx-gossip': 4,
  'block-gossip': 5,
  'tx-request': 6,
  'block-request': 7,
};
// tslint:enable:object-literal-sort-keys

export type ICommandsKeys = keyof typeof COMMANDS;

export const COMMANDS_INVERSE: { [commandNumber: number]: ICommandsKeys } = {};
// tslint:disable-next-line:forin
for (const command in COMMANDS) {
  COMMANDS_INVERSE[COMMANDS[command as ICommandsKeys]] = command as ICommandsKeys;
}
