import {NODE_ID_LENGTH} from "../main/constants";
import {
  ADDRESS_LENGTH,
  ADDRESS_PAYLOAD_LENGTH,
  COMMANDS,
  COMMANDS_INVERSE,
  ICommandsKeys,
  IDENTIFICATION_PAYLOAD_LENGTH, NODE_CONTACT_INFO_PAYLOAD_LENGTH, NODE_TYPES,
  NODE_TYPES_INVERSE,
} from "./constants";
import {INodeContactAddress, INodeContactIdentification, INodeContactInfo} from "./INetwork";

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

export function composeIdentificationPayload(nodeContactIdentification: INodeContactIdentification): Uint8Array {
  const identificationPayload = new Uint8Array(IDENTIFICATION_PAYLOAD_LENGTH);
  identificationPayload.set([NODE_TYPES[nodeContactIdentification.nodeType]]);
  identificationPayload.set(nodeContactIdentification.nodeId, 1);

  return identificationPayload;
}

export function parseIdentificationPayload(identificationPayload: Uint8Array): INodeContactIdentification {
  if (identificationPayload.length < IDENTIFICATION_PAYLOAD_LENGTH) {
    throw new Error(`Too few data for identification payload, ${identificationPayload.length} bytes given, at least ${IDENTIFICATION_PAYLOAD_LENGTH} bytes expected`);
  }
  return {
    nodeId: identificationPayload.slice(1, 1 + NODE_ID_LENGTH),
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
  addressPayload.set(encoder.encode(nodeContactAddress.address).subarray(0, 64), 6);
  return addressPayload;
}

export function parseAddressPayload(addressPayload: Uint8Array): INodeContactAddress {
  if (addressPayload.length < ADDRESS_PAYLOAD_LENGTH) {
    throw new Error(`Too few data for address payload, ${addressPayload.length} bytes given, at least ${ADDRESS_PAYLOAD_LENGTH} bytes expected`);
  }
  const view = new DataView(addressPayload.buffer, addressPayload.byteOffset, addressPayload.byteLength);
  const tcp4Port = view.getUint16(0, false) || undefined;
  const udp4Port = view.getUint16(2, false) || undefined;
  const wsPort = view.getUint16(4, false) || undefined;
  const address = decoder.decode(
    Uint8Array.from(
      addressPayload.subarray(6, ADDRESS_LENGTH + 6)
        .filter((byte) => {
          return byte !== 0;
        }),
    ),
  ) || undefined;
  return {address, tcp4Port, udp4Port, wsPort};
}

/**
 * Essentially combination of `composeIdentificationPayload()` and `composeAddressPayload()` for better efficiency
 *
 * @param nodeContactInfo
 * @param targetUint8Array If target array already exists, avoids unnecessary allocation and writes there instead
 */
export function composeNodeInfoPayload(nodeContactInfo: INodeContactInfo, targetUint8Array?: Uint8Array): Uint8Array {
  const nodeInfoPayload = targetUint8Array || new Uint8Array(NODE_CONTACT_INFO_PAYLOAD_LENGTH);
  nodeInfoPayload.set([NODE_TYPES[nodeContactInfo.nodeType]]);
  nodeInfoPayload.set(nodeContactInfo.nodeId, 1);
  const view = new DataView(nodeInfoPayload.buffer, nodeInfoPayload.byteOffset, nodeInfoPayload.byteLength);
  view.setUint16(IDENTIFICATION_PAYLOAD_LENGTH, nodeContactInfo.tcp4Port || 0, false);
  view.setUint16(IDENTIFICATION_PAYLOAD_LENGTH + 2, nodeContactInfo.udp4Port || 0, false);
  view.setUint16(IDENTIFICATION_PAYLOAD_LENGTH + 4, nodeContactInfo.wsPort || 0, false);
  nodeInfoPayload.set(
    encoder.encode(nodeContactInfo.address).subarray(0, ADDRESS_LENGTH),
    IDENTIFICATION_PAYLOAD_LENGTH + 6,
  );

  return nodeInfoPayload;
}

/**
 * Essentially combination of `parseIdentificationPayload()` and `parseAddressPayload()`
 *
 * @param nodeInfoPayload
 */
export function parseNodeInfoPayload(nodeInfoPayload: Uint8Array): INodeContactInfo {
  if (nodeInfoPayload.length < NODE_CONTACT_INFO_PAYLOAD_LENGTH) {
    throw new Error(`Too few data for node info payload, ${nodeInfoPayload.length} bytes given, at least ${NODE_CONTACT_INFO_PAYLOAD_LENGTH} bytes expected`);
  }
  return {
    ...parseIdentificationPayload(nodeInfoPayload),
    ...parseAddressPayload(nodeInfoPayload.subarray(IDENTIFICATION_PAYLOAD_LENGTH)),
  };
}

export function composePeersBinary(peers: INodeContactInfo[]): Uint8Array {
  const numberOfPeers = peers.length;
  // First byte is number of peers followed by their contact info
  const peersBinary = new Uint8Array(1 + numberOfPeers * NODE_CONTACT_INFO_PAYLOAD_LENGTH);
  peersBinary.set([numberOfPeers]);
  for (let i = 0; i < numberOfPeers; ++i) {
    composeNodeInfoPayload(
      peers[i],
      peersBinary.subarray(
        1 + NODE_CONTACT_INFO_PAYLOAD_LENGTH * i,
        1 + NODE_CONTACT_INFO_PAYLOAD_LENGTH * (i + 1),
      ),
    );
  }

  return peersBinary;
}

export function parsePeersBinary(peersBinary: Uint8Array): INodeContactInfo[] {
  if (!peersBinary.length) {
    throw new Error('Peers binary should be at least one byte length');
  }
  const numberOfPeers = peersBinary[0];
  if (peersBinary.length < (1 + numberOfPeers * NODE_CONTACT_INFO_PAYLOAD_LENGTH)) {
    throw new Error(`Too few data for peers binary, ${peersBinary.length} bytes given, at least ${1 + numberOfPeers * NODE_CONTACT_INFO_PAYLOAD_LENGTH} bytes expected`);
  }
  const peers: INodeContactInfo[] = [];
  for (let i = 0; i < numberOfPeers; ++i) {
    peers.push(
      parseNodeInfoPayload(
        peersBinary.subarray(
          1 + NODE_CONTACT_INFO_PAYLOAD_LENGTH * i,
          1 + NODE_CONTACT_INFO_PAYLOAD_LENGTH * (i + 1),
        ),
      ),
    );
  }

  return peers;
}
