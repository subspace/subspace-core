// tslint:disable:object-literal-sort-keys
export const COMMANDS = {
  response: 0,
  identification: 1,
  gossip: 2,
  ping: 3,
  pong: 4,
  block: 5,
  transaction: 6,
};
// tslint:enable:object-literal-sort-keys

export type ICommandsKeys = keyof typeof COMMANDS;

export const COMMANDS_INVERSE: { [commandNumber: number]: ICommandsKeys } = {};
// tslint:disable-next-line:forin
for (const command in COMMANDS) {
  COMMANDS_INVERSE[COMMANDS[command as ICommandsKeys]] = command as ICommandsKeys;
}

export const GOSSIP_COMMANDS = new Set<ICommandsKeys>([
  'block',
  'transaction',
]);
