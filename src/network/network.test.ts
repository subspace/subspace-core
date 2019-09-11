import {randomBytes} from "crypto";
import {IPeerContactInfo} from "../main/interfaces";
import {allocatePort, parseContactInfo} from "../utils/utils";
import {Network} from "./Network";

const peer1: IPeerContactInfo = {
  address: 'localhost',
  nodeId: Buffer.from('1'.repeat(64), 'hex'),
  protocolVersion: '4',
  tcpPort: allocatePort(),
  udpPort: allocatePort(),
  wsPort: allocatePort(),
};

const peer2: IPeerContactInfo = {
  address: 'localhost',
  nodeId: Buffer.from('2'.repeat(64), 'hex'),
  protocolVersion: '4',
  tcpPort: allocatePort(),
  udpPort: allocatePort(),
  wsPort: allocatePort(),
};

const peer3: IPeerContactInfo = {
  address: 'localhost',
  nodeId: Buffer.from('3'.repeat(64), 'hex'),
  protocolVersion: '4',
  tcpPort: allocatePort(),
  udpPort: allocatePort(),
  wsPort: allocatePort(),
};

const peer4: IPeerContactInfo = {
  address: 'localhost',
  nodeId: Buffer.from('4'.repeat(64), 'hex'),
  protocolVersion: '4',
  tcpPort: allocatePort(),
  udpPort: allocatePort(),
  wsPort: allocatePort(),
};

const networkOptions1 = parseContactInfo(peer1, [peer2, peer3]);
const networkOptions2 = parseContactInfo(peer2, [peer1]);
const networkOptions3 = parseContactInfo(peer3, [peer1]);
const networkOptions4 = parseContactInfo(peer4, [peer1], true);

let networkClient1: Network;
let networkClient2: Network;
let networkClient3: Network;
let networkClient4: Network;

beforeEach(() => {
  networkClient1 = new Network(...networkOptions1);
  networkClient2 = new Network(...networkOptions2);
  networkClient3 = new Network(...networkOptions3);
  networkClient4 = new Network(...networkOptions4);
});

describe('UDP', () => {
  test('Send one-way unreliable', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      networkClient2.on('ping', (payload) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        resolve();
      });
      networkClient1.sendOneWayRequestUnreliable(peer2.nodeId, 'ping', randomPayload);
    });
  });

  test('Send unreliable', async () => {
    const randomPayload = randomBytes(32);
    const [, payload] = await Promise.all([
      new Promise((resolve) => {
        networkClient2.on('ping', async (payload, responseCallback) => {
          expect(payload.join(', ')).toEqual(randomPayload.join(', '));
          responseCallback(randomPayload);
          resolve();
        });
      }),
      networkClient1.sendRequestUnreliable(peer2.nodeId, 'ping', randomPayload),
    ]);
    expect(payload.join(', ')).toEqual(randomPayload.join(', '));
  });
});

describe('TCP', () => {
  test('Send one-way reliable', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      networkClient2.on('ping', (payload) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        resolve();
      });
      networkClient1.sendOneWayRequest(peer2.nodeId, 'ping', randomPayload);
    });
  });

  test('Send reliable', async () => {
    const randomPayload = randomBytes(32);
    const [, payload] = await Promise.all([
      new Promise((resolve) => {
        networkClient2.on('ping', async (payload, responseCallback) => {
          expect(payload.join(', ')).toEqual(randomPayload.join(', '));
          responseCallback(randomPayload);
          resolve();
        });
      }),
      networkClient1.sendRequest(peer2.nodeId, 'ping', randomPayload),
    ]);
    expect(payload.join(', ')).toEqual(randomPayload.join(', '));
  });
});

describe('WebSocket', () => {
  test('Send one-way reliable', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      networkClient1.on('ping', (payload) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        resolve();
      });
      networkClient4.sendOneWayRequest(peer1.nodeId, 'ping', randomPayload);
    });
  });

  test('Send reliable', async () => {
    const randomPayload = randomBytes(32);
    const [, payload] = await Promise.all([
      new Promise((resolve) => {
        networkClient1.on('ping', async (payload, responseCallback) => {
          expect(payload.join(', ')).toEqual(randomPayload.join(', '));
          responseCallback(randomPayload);
          resolve();
        });
      }),
      // TODO: Changing `peer1` to `peer2` causes test to fail, likely because of concurrent execution with the same port
      networkClient4.sendRequest(peer1.nodeId, 'ping', randomPayload),
    ]);
    expect(payload.join(', ')).toEqual(randomPayload.join(', '));
  });
});

describe('Gossip', () => {
  test('Send gossip command', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      let waitingFor = 3;
      networkClient1.once('tx-gossip', (payload) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        --waitingFor;
        if (!waitingFor) {
          resolve();
        }
      });
      networkClient2.once('tx-gossip', (payload) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        --waitingFor;
        if (!waitingFor) {
          resolve();
        }
      });
      networkClient3.once('tx-gossip', (payload) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        --waitingFor;
        if (!waitingFor) {
          resolve();
        }
      });
      networkClient4.gossip('tx-gossip', randomPayload);
    });
  });
});

afterEach(async () => {
  await networkClient1.destroy();
  await networkClient2.destroy();
  await networkClient3.destroy();
});
