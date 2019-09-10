// node 1
  // bootstrap the node without any peer info

// node 2
  // bootstrap the node with node 1s peer contact info

// start farming on node 1

// validate blocks on node 2

// may need to add a delay to allow sync to occur (slow it down)

  // const selfContactInfo: IPeerContactInfo = {
  //   nodeId: new Uint8Array(),
  //   address: 'localhost',
  //   udpPort: 8001,
  //   tcpPort: 8002,
  //   wsPort: 8003,
  //   protocolVersion: '4',
  // };

  // const peerContactInfo: IPeerContactInfo[] = [{
  //   nodeId: randomBytes(32),
  //   address: 'localhost',
  //   udpPort: 8004,
  //   tcpPort: 8005,
  //   wsPort: 8006,
  //   protocolVersion: '4',
  // }];
