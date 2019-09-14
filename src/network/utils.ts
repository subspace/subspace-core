import {ADDRESS_PAYLOAD_LENGTH, COMMANDS, COMMANDS_INVERSE, ICommandsKeys, NODE_TYPES_INVERSE} from "./constants";
import {INodeContactAddress, INodeContactIdentification} from "./INetwork";

export function noopResponseCallback(): void {
  // Do nothing
}

/**
 * @param command
 * @param requestResponseId `0` if no response is expected for request
 * @param payload
 */
export function composeMessage(command: ICommandsKeys, requestResponseId: number, payload: Uint8Array): Uint8Array {
  // 1 byte for command, 4 bytes for requestResponseId
  const message = new Uint8Array(1 + 4 + payload.length);
  const view = new DataView(message.buffer);
  message.set([COMMANDS[command]]);
  view.setUint32(1, requestResponseId, false);
  message.set(payload, 1 + 4);
  return message;
}

/**
 * TODO: There is no verification about where message came from
 *
 * @param message
 *
 * @return [command, requestId, payload]
 */
export function parseMessage(message: Uint8Array): [ICommandsKeys, number, Uint8Array] {
  if (message.length < 5) {
    throw new Error(`Incorrect message length ${message.length} bytes, at least 5 bytes expected`);
  }
  const command = COMMANDS_INVERSE[message[0]];
  if (!command) {
    throw new Error(`Unknown command number ${message[0]}`);
  }
  const view = new DataView(message.buffer, message.byteOffset, message.byteLength);
  const requestId = view.getUint32(1);
  const payload = new Uint8Array(
    message.buffer,
    message.byteOffset + 5,
    message.byteLength - 5,
  );

  return [command, requestId, payload];
}

export function parseIdentificationPayload(identificationPayload: Uint8Array): INodeContactIdentification {
  return {
    nodeId: identificationPayload.slice(1),
    nodeType: NODE_TYPES_INVERSE[identificationPayload[0]],
  };
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function composeAddressPayload(nodeContactAddress: INodeContactAddress): Uint8Array {
  const addressPayload = new Uint8Array(ADDRESS_PAYLOAD_LENGTH);
  const view = new DataView(addressPayload.buffer);
  view.setUint16(0, nodeContactAddress.tcp4Port || 0, false);
  view.setUint16(2, nodeContactAddress.udp4Port || 0, false);
  view.setUint16(4, nodeContactAddress.wsPort || 0, false);
  addressPayload.set(encoder.encode(nodeContactAddress.address), 6);
  return addressPayload;
}

export function parseAddressPayload(addressPayload: Uint8Array): INodeContactAddress {
  const view = new DataView(addressPayload.buffer, addressPayload.byteOffset, addressPayload.byteLength);
  const tcp4Port = view.getUint16(0, false) || undefined;
  const udp4Port = view.getUint16(2, false) || undefined;
  const wsPort = view.getUint16(4, false) || undefined;
  const address = decoder.decode(addressPayload.subarray(6));
  return {address, tcp4Port, udp4Port, wsPort};
}
