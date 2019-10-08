# Subspace Core

A monorepo that includes everything needed to run a full node for the Subspace Ledger.

## Usage

> Note: requires Node JS v12 or higher to be installed

### Install and run from GitHub

```
git clone https://wwww.github.com/subspace/subspace-core
cd subspace-core
npm install
npm run build
ts-node src/main/index.ts
```

Default params may be changed in `src/main/index.ts`

### Install and run with Docker

CLI interface using Docker is also available. You can run it like this for x86_64 and ARM architectures:

```bash
docker run --rm -it --entrypoint=/usr/bin/node subspacelabs/subspace-core /code/dist/main/index.js
docker run --rm -it --entrypoint=/usr/bin/node subspacelabs/subspace-core:arm64v8 /code/dist/main/index.js
docker run --rm -it --entrypoint=/usr/bin/node subspacelabs/subspace-core:arm32v7 /code/dist/main/index.js

```

If you prefer to build it yourself, here is how:

```bash
docker build -t subspacelabs/subspace-core .
docker build -t subspacelabs/subspace-core:arm64v8 -f Dockerfile-arm64v8 .
docker build -t subspacelabs/subspace-core:arm32v7 -f Dockerfile-arm32v7 .
```

### Install and run from NPM (pending)

```
npm install -g @subspace/subspace-core
subspace run
```

## Design

### Target Runtime
* Primarily written in [Typescript](https://www.typescriptlang.org/) for a [Node JS](https://nodejs.org) runtime.
* Mission critical code written in [Rust](https://www.rust-lang.org/), compiled to [Web Assembly](https://webassembly.org/) using [wasm-pack](https://rustwasm.github.io/wasm-pack/) and called from JS Runtime. 

### Cross Platform
* Node JS implementation may be run anywhere with [Docker](https://www.docker.com/). 
* May be compiled with [Browserify](http://browserify.org/) to run in any browser JS runtime. 
* May be used with [Electron](https://electronjs.org/) for cross-platform desktop app development. 

### Development
* Full test suite with [Jest](https://jestjs.io/) run with `npm test`
* Auto-generated documentation with [TypeDoc](https://typedoc.org) run with `npm gen-docs` to [/docs](../docs/index.html)
* Published as module to [NPM](https://www.npmjs.com/)
* Docker containers hosted on [DockerHub](https://hub.docker.com/)

### User Interfaces
Subspace Network Daemon (SND), a CLI built using [Commander](https://github.com/tj/commander.js/)<br>

Run with `bin/subspace.js` from the root of the repository or just using `subspace` when installed globally using `npm install -g @subspace/subspace-core`.

A simple GUI can be viewed from [/app/web/index.html](/app/web/index.html) built with vanilla [Vue](https://vuejs.org/) and [Bulma](https://bulma.io/). This will run the browserified version of the protocol as a standalone network node with its own copy of the ledger from genesis -- primarily for testing purposes right now.

## Modules

For the purposes of this document, a module refers to top level directory within the src folder that organizes some code. External npm modules are referred to as dependencies. We are taking a monorepo approach. Instead of using separate NPM modules and git repositories for each module we will simply use different folders within the same core project. Later, we may use [Lerna](https://lerna.js.org/) to separate each folder into a discrete module, which may all be managed from the core project.  

Currently there are ten modules. `Main` wraps `Node`, which is the base class for a network node. `Wallet`, `Farm`, `Ledger`, `Network`, and `Storage` are sub classes that provide specific functionality. `Utils`, `Crypto` and `Codes` are collections of logically grouped helper functions.

### Main

Entry point for the project through `index.ts`. Also defines the constants and shared Typescript interfaces for the project. Essentially a wrapper around the core functionality provide by the `Node` class that allows for one more layer of abstraction when defining initialization and environment parameters.

### Node

Master class for the running a 'node' on the Subspace Network that implements all other modules and dependencies.

1. Manages the connection to the subspace network 
2. Manages a wallet for one or more node ids.
3. Tracks the current state of the ledger.
4. Executes the validate, solve, prove loop for farming and ledger validation.
5. Manages the plots for farming.
6. Interfaces with local storage media for persistence.

### Wallet

Manages identities (profiles) for nodes on the network. An identity is not required to join and query the network.

1. Securely create, store, manage, and delete BLS Public/Private key pairs and associated metadata (via crypto and storage modules)
2. View balances of any valid subspace network address (via ledger and network modules)
3. Send funds from one address to another with a valid key pair (via ledger and network modules)

### Farm

Manages plots for this node. A node may have many plots. A plot is a set of encoded pieces under a given node id (address). If the ledger is small, nodes must have many plots to fully utilize their free disk. Once the ledger is large (> 16 TB) we would expect most nodes to have a single plot. Multiple plots per node will make testing sybil attacks far easier as well. Farming is purely optional and not required to query the network or maintain a copy of the Ledger. Each plot is initialized with a different path, which may be on different drives.

1. Encodes pieces under a node id and persists them through a plot mode.
2. Current modes include pure in-memory (mem-db) and on-disk (rocks-db). Future modes include raw-disk and on-the-fly computation from unencoded pieces stored in memory (for security analysis).
3. Uses a Red Black tree that combines memory and disk storage for indexing a plot with fast lookups.
4. Retrieves encodings from a piece id and returns the encoding or original pieces (storage and codes modules)

### Ledger

Manages the state of the ledger, which is the collection of all parallel chains for the network. Currently a work in progress.

1. Tracks the pending state of the ledger in memory.
2. May store the archival state of the ledger on disk (unencoded).
3. Assigns new block to chains and determines when to confirm a new level (collection of blocks across chains)
4. Compresses levels into state blocks and applies piece encodings.
5. Stores state blocks in memory, potentially with a fly-client approach.
6. Maintains a balance of all active accounts network (account based vs UTXO based)
7. Maintains a memory pool of pending blocks (proofs + contents) and transactions (txs).
8. Creates and validates new txs, proofs, and contents.

### Storage

Manages persistent state in a cross-platform manner.

1. Maintains a simple key-value database for persistent storage with a [level-db](https://github.com/google/leveldb) compliant API 
2. Uses Rocks DB for Node JS through [Rocks DB Node](https://github.com/Level/level-rocksdb)
3. Uses indexed-db in the Browser through [Level-js](https://github.com/Level/level-js)

### Network

Not yet implemented.

Manages a connection to the subspace network across multiple transports with multiple modes of operation.

1. Defines a simple RPC that is gRPC compatible (allowing simple REST and graphQL interfaces)
2. Provides a basic gossip protocol over UDP.
3. Provides a ledger / piece sync protocol over TCP.
4. Provides a lightweight Kademlia Distributed Sloppy Hash Table (K-DSHT) over UDP & TCP.
5. Provides a browser sync protocol over WebSockets (WS) where a Node JS node with public IP may run a WS Server
6. Provides a browser P2P protocol over WebRTC (WRTC) where a Node JS with public IP may run a WRTC Relay server.
7. Eventually may support a torrent style ledger / piece sync protocol TCP and WS.

### Crypto

A convenience wrapper around a set of standard cryptographic primitives. Goal is to convert all to Rust and expose via WASM for performance.

1. Implements basic hash functions from the Node JS crypto standard library.
2. Implements a secure pseudo random number generator via a Poisson process (pending)
3. Implements binary merkle tree library. Currently Typescript based, eventually port to WASM via Rust.
4. Implements a Jump Consistent Hash function to assign blocks to chains. Currently Typescript based, eventually port to WASM via Rust.
5. Implements Chia Network BLS Signature library via WASM port. Provides deterministic key generation that supports HD Wallets and a unique signature scheme with aggregation.

### Codes

A convenience wrapper around a set of algorithms for encoding and decoding pieces of the ledger. Goal is to convert all to Rust and expose via WASM for performance.

1. Level Coding: Slices a level (set of proofs and unique contents across many new blocks) into a set of 4096 byte content-addressed pieces, padding the last piece. 
2. Erasure Codes: Create a set of parity pieces that may be used to recover a level given a constant subset of pieces. Currently uses [Backblaze Reed-Solomon](https://github.com/ronomon/reed-solomon) implementation ported to Node JS. Attempting to user a more efficient [port to Rust](https://github.com/darrenldl/reed-solomon-erasure). Need to benchmark and compare some other, possibly faster libraries [written in C++](https://github.com/catid/longhair)
3. Piece Coding: A simple Pseudo Random Permutation (PRP) CBC XOR cipher that uses the node id as the initialization vector. Encoding is inherently sequential with a variable number of rounds. Decoding is inherently parallelizable. 
4. Hourglass Function: A second PRP that applies a slow, time-delay encoding to the encoded piece that is efficiently reversible. Candidate function include memory hard encoding, verifiable delay encoding, random permutations, and Poehling-Hellman ciphers.

## External Dependencies

* [Merkle Tree Binary](https://github.com/nazar-pc/merkle-tree-binary) 
* [Jump Consistent Hash](https://github.com/subspace/jump-consistent-hash) 
* [BLS Signatures](https://github.com/Chia-Network/bls-signatures)
* [Erasure Coding](https://github.com/ronomon/reed-solomon)
* [Red-Black Tree](https://github.com/subspace/red-black-tree)
* [Rocks DB Node](https://github.com/Level/level-rocksdb)
* [Level-js](https://github.com/Level/level-js)
* [Bit Torrent DHT](https://github.com/webtorrent/bittorrent-dht)
