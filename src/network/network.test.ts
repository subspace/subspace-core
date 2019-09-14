import {randomBytes} from "crypto";
import {IPeerContactInfo} from "../main/interfaces";
import {allocatePort} from "../utils/utils";
import {Network} from "./Network";

const peer1: IPeerContactInfo = {
  address: 'localhost',
  nodeId: Buffer.from('1'.repeat(64), 'hex'),
  nodeType: 'full',
  tcp4Port: allocatePort(),
  udp4Port: allocatePort(),
  wsPort: allocatePort(),
};

const peer2: IPeerContactInfo = {
  address: 'localhost',
  nodeId: Buffer.from('2'.repeat(64), 'hex'),
  nodeType: 'full',
  tcp4Port: allocatePort(),
  udp4Port: allocatePort(),
  wsPort: allocatePort(),
};

const peer3: IPeerContactInfo = {
  address: 'localhost',
  nodeId: Buffer.from('3'.repeat(64), 'hex'),
  nodeType: 'full',
  tcp4Port: allocatePort(),
  udp4Port: allocatePort(),
  wsPort: allocatePort(),
};

const peer4: IPeerContactInfo = {
  address: 'localhost',
  nodeId: Buffer.from('4'.repeat(64), 'hex'),
  nodeType: 'client',
};

let networkClient1: Network;
let networkClient2: Network;
let networkClient3: Network;
let networkClient4: Network;

beforeEach(async () => {
  networkClient1 = await Network.init(peer1, [peer2, peer3], false);
  networkClient2 = await Network.init(peer2, [peer1], false);
  networkClient3 = await Network.init(peer3, [peer1], false);
  networkClient4 = await Network.init(peer4, [peer1], true);
});

describe('UDP', () => {
  test('Send one-way unreliable', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      networkClient2.once('ping', (payload, _, clientIdentification) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        expect(clientIdentification.nodeId.join(', ')).toEqual(peer1.nodeId.join(', '));
        expect(clientIdentification.nodeType).toEqual(peer1.nodeType);
        resolve();
      });
      networkClient1.sendRequestOneWayUnreliable(['full'], 'ping', randomPayload);
    });
  });

  test('Send unreliable', async () => {
    const randomPayload = randomBytes(32);
    const [, payload] = await Promise.all([
      new Promise((resolve) => {
        networkClient2.once('ping', async (payload, responseCallback, clientIdentification) => {
          expect(payload.join(', ')).toEqual(randomPayload.join(', '));
          expect(clientIdentification.nodeId.join(', ')).toEqual(peer1.nodeId.join(', '));
          expect(clientIdentification.nodeType).toEqual(peer1.nodeType);
          responseCallback(randomPayload);
          resolve();
        });
      }),
      networkClient1.sendRequestUnreliable(['full'], 'ping', randomPayload),
    ]);
    expect(payload.join(', ')).toEqual(randomPayload.join(', '));
  });
});

describe('TCP', () => {
  test('Send one-way reliable', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      networkClient2.once('ping', (payload, _, clientIdentification) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        expect(clientIdentification.nodeId.join(', ')).toEqual(peer1.nodeId.join(', '));
        expect(clientIdentification.nodeType).toEqual(peer1.nodeType);
        resolve();
      });
      networkClient1.sendRequestOneWay(['full'], 'ping', randomPayload);
    });
  });

  test('Send reliable', async () => {
    const randomPayload = randomBytes(32);
    const [, payload] = await Promise.all([
      new Promise((resolve) => {
        networkClient2.once('ping', async (payload, responseCallback, clientIdentification) => {
          expect(payload.join(', ')).toEqual(randomPayload.join(', '));
          expect(clientIdentification.nodeId.join(', ')).toEqual(peer1.nodeId.join(', '));
          expect(clientIdentification.nodeType).toEqual(peer1.nodeType);
          responseCallback(randomPayload);
          resolve();
        });
      }),
      networkClient1.sendRequest(['full'], 'ping', randomPayload),
    ]);
    expect(payload.join(', ')).toEqual(randomPayload.join(', '));
  });
});

describe('WebSocket', () => {
  test('Send one-way reliable', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      networkClient1.once('ping', (payload, _, clientIdentification) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        expect(clientIdentification.nodeId.join(', ')).toEqual(peer4.nodeId.join(', '));
        expect(clientIdentification.nodeType).toEqual(peer4.nodeType);
        resolve();
      });
      networkClient4.sendRequestOneWay(['full'], 'ping', randomPayload);
    });
  });

  test('Send reliable', async () => {
    const randomPayload = randomBytes(32);
    const [, payload] = await Promise.all([
      new Promise((resolve) => {
        networkClient1.once('ping', async (payload, responseCallback, clientIdentification) => {
          expect(payload.join(', ')).toEqual(randomPayload.join(', '));
          expect(clientIdentification.nodeId.join(', ')).toEqual(peer4.nodeId.join(', '));
          expect(clientIdentification.nodeType).toEqual(peer4.nodeType);
          responseCallback(randomPayload);
          resolve();
        });
      }),
      networkClient4.sendRequest(['full'], 'ping', randomPayload),
    ]);
    expect(payload.join(', ')).toEqual(randomPayload.join(', '));
  });
});

describe('Gossip', () => {
  test('Send gossip command', async () => {
    const randomPayload = randomBytes(32);
    return new Promise((resolve) => {
      let waitingFor = 3;
      networkClient1.once('tx-gossip', (payload, _, clientIdentification) => {
        expect(payload.join(', ')).toEqual(randomPayload.join(', '));
        expect(clientIdentification.nodeId.join(', ')).toEqual(peer4.nodeId.join(', '));
        expect(clientIdentification.nodeType).toEqual(peer4.nodeType);
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

// describe('Identification', () => {
//   test('Send one-way reliable to initially unknown', async () => {
//     const randomPayload = randomBytes(32);
//     return new Promise((resolve) => {
//       networkClient4.once('ping', (payload, _, clientIdentification) => {
//         expect(payload.join(', ')).toEqual(randomPayload.join(', '));
//         expect(clientIdentification.nodeId.join(', ')).toEqual(peer1.nodeId.join(', '));
//         expect(clientIdentification.nodeType).toEqual(peer1.nodeType);
//         resolve();
//       });
//       networkClient1.sendRequestOneWay(['client'], 'ping', randomPayload);
//     });
//   });
//
// });

afterEach(async () => {
  await networkClient1.destroy();
  await networkClient2.destroy();
  await networkClient3.destroy();
  await networkClient4.destroy();
});
