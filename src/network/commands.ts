// tslint:disable:object-literal-sort-keys
export const COMMANDS = {
  response: 0,
  ping: 1,
  pong: 2,
};
// tslint:enable:object-literal-sort-keys

export type ICommandsKeys = keyof typeof COMMANDS;

export const COMMANDS_INVERSE: { [commandNumber: number]: ICommandsKeys } = {};
// tslint:disable-next-line:forin
for (const command in COMMANDS) {
  COMMANDS_INVERSE[COMMANDS[command as ICommandsKeys]] = command as ICommandsKeys;
}
