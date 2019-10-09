## Ledger Design & Architecture

`Ledger` is the most important module within `Subspace-Core` as it contains the distributed ledger implementation that allows the Subspace Network to maintain secure, distributed consensus through 'cheap' and 'fast' proofs-of-storage. Put simply, the Ledger is just a balance of accounts, where each 32 byte account address maps to a 4 byte integer balance of Subspace Credits. Since the head state of the ledger can be quite large, we have chosen to adopt an account based model over a UTXO model. This reduces the burden on how much state must be kept in memory for nodes (and especially light clients) to roughly 40 bytes per account. Given a current BTC full node this translates to ~ 3.5 GB with a UTXO model and 40 MB for an account based model.

This module is organized into separate class files for each major sub-system:

* `Tx`: A simple, immutable, account-based transaction (tx) record class for sending and receiving credits (coins).
* `Content`: A malleable record class for summarizing the tx content of a `Block`.
* `Proof`: A canonical proof-of-storage record class.
* `Block`: A composite helper class that contains the `Proof`, `Content`, and every unique `Tx`.
* `Chain`: A helper class that tracks `Blocks`
* `State`: A record class that summarizes a constant-sized set of confirmed, erasure coded records.
* `Ledger`: The primary class that orchestrates all child classes and implements core consensus logic.

Each `Node` has a single `Ledger` that is comprised of many parallel `Chains` (i.e. 1 to 1024) Each `Block` is comprised of a canonical `Proof`(the proof-of-storage) and a malleable `content` (the tx data) record. Each `chain` can then be decomposed into a `proof` chain and a `content` chain. Each new block is used to extend a different chain at random, based on the hash of the included proof. That proof is also used as the basis for the challenge that serves as the input for the next block in the chain. This process continues until enough valid blocks have been confirmed to erasure code state into a new piece set, which is summarized with a new state block. Farmers will then plot the new piece set, while any node that has the `State` chain (i.e. a light client) can validate proofs-of-storage using the merkle root of each new piece set that is included in each `state` block. 

## Key Concepts

### Parallel Chain Structure (prevent forks)

Since proofs-of-storage can be created much faster than they will propagate across all nodes on the network, a single chain Subspace `Ledger` would have an extremely high fork rate and the network would be susceptible to double-spending attacks with far less than 51% of the storage resources.

To resolve this fundamental problem, we run multiple chains in parallel. We treat each chain as if it were a bucket in a hash table, and each block as though it were a record in the hash table. Specifically, we hash the canonical proof-of-storage within the block, and use this proof hash as the input into a deterministic, jump-consistent-hash function to map the block to chain. This allows all nodes on the network to place each block into the same chain, as long as they agree on the number of chains and the jump-hash-function.

If we have the number of chains configured correctly, then w.h.p. each proof should hash to a different chain. The probability that any two proofs will hash to the same chain can be set s.t. it is equal to the probability of generating two proofs (or two blocks) at the same time (as in Bitcoin), by properly configuring the number of chains. This allows us to maintain the same level of security as a properly calibrated single-chain proof-of-work ledger, with a much faster confirmation time and much higher block/tx throughput.  

### Preventing Grinding Attacks

To ensure proof-of-storage does not devolve back into proof-of-work, we must be very careful as to how the ledger data structures and pointers are constructed, or else a rational node would substitute or supplant storage resources with computational resources to gain an advantage by 'grinding' on potential challenges or solutions.

To prevent this, we separate each `Block` into canonical `Proof` and malleable `Content` records. For any given combination of a piece encoding and block challenge, there must be exactly one valid `proof` that can be constructed. To do this we must remove all malleable data from the proof, and ensure that what remains is deterministically generated. Specifically, we must use a canonical signature scheme while moving the malleable tx data to the associated `content`.  

We can then have two sub-chains for each chain. First, a `proof` chain that points to the parent `proof` of the last block seen, which is not necessarily the same chain that the new `proof` will hash to. Second, a `content` chain that points to up to last block in the chain that the proof hashes to, and back to the proof itself. If we base the new block challenge on the last proof, we can construct a chain of proofs that in no way depends on the malleable content data and prevent nodes from varying the ordering of inputs of the data (grinding) to generate slightly different proofs or challenges. 

### Canonical Signature Scheme

In Subspace, proofs-of-storage must be linked to the public key used to seed the plot, in order for the prover to demonstrate authenticity and non-outsourceability of the proof (and storage). To do this, a node must sign the proof content (which includes the challenge) with the private key linked to the public key used to generate the encoding of the piece included in the proof. 

If we use a traditional signature scheme such ECDSA we have the problem of signature malleability, in which the same data, signed with the same private key, can produce many different valid signatures. This would allow a rational node to grind on valid proofs by simply re-signing them over and over until they hash to a valid chain. This would break both the security and the fairness of the system, as nodes could improve their probability of solving with additional CPU, and they could influence which chain their proof hashes to, which is expected to be random and unpredictable.

To solve this problem we must use a signature scheme that is canonical, unique, and deterministic, where for any given message and private key we will always create the same signature, and thus we can only have one valid proof for any given solution. Specifically, we use the BLS signature scheme with the BLS12-384 curve to attain this property.

As an added benefit, a canonical signature scheme also allows for canonical transactions. In a traditional blockchain architecture, every tx is sent across the network twice. First when it is gossiped to the network, then again when the parent block is gossiped, which includes every full tx, not just a pointer. Since the tx content makes up the bulk of the block size, this severely limits the number of txs that may be included in a block. 

While this may at first appear to be a redundant and inefficient implementation detail, it is actually a core feature that is critical to the security of the system. As mentioned above, there are many valid ECDSA signatures for the same key and tx data. If we just referenced the tx by its hash within the block, then there is a chance that the tx could be resigned within the block interval, and we could have two transactions that reference the same inputs and outputs with different hashes. 

Since Subspace uses BLS, we do not have this problem, and can instead simply include the SHA-256 hash of each tx that is to be included in the block. Allowing us to store 10-20x more tx per block of the same size (32 byte hash to ~ 300 byte tx). 

### Ensuring there is one valid challenge per block

Since we have many chains, fast solution times, and an asynchronous network with variable propagation delays, we cannot expect all nodes to apply updates to the ledger (i.e. new blocks) in the order they are received. While the state is eventually consistent, in that a common picture of the ledger will eventually converge for all nodes, we cannot expect nodes to wait for convergence before solving. To handle these problems, we apply a few simple rules to solving and validating new proofs:

1. Any new valid block may be used as the input to a new challenge, through the hash of its proof.
2. The resulting block (and solution) is valid i.f.f. the chain that the proof hashes to has not yet 'seen' (in its parent history) the block referenced as the challenge input.
3. If a new block hashes to a chain that has already seen the challenge, we have a fork. We will always favor the branch of the fork that has the highest aggregate proof quality. 

Combined, these rules create a system where every farmer can legally solve once for each new block, with the caveat that the resulting solution will quickly expire as it becomes valid on fewer and fewer chains. This window will quickly converge to a constant time for any given propagation delay and number of chains, since it can be modeled as an exponential decay process. Intuitively, as each new chain is extended by a block that sees a particular challenge, the number of valid chains will decrease linearly over time. A new block can refereance a challange either directly, as the parent proof or parent content, or indirectly, as an ancestor of its parent proof or content. If we add to this the randomness by which any proof is valid for a chain (through the jump consistent hash algorithm) then the probability that any particular proof is valid for the remaining valid chains will decrease exponentially as more chains become invalid.

In the event that two proofs for the same challenge hash to different chains at roughly the same time, we are fine. While this would be a fork if we had a single chain ledger, the parallel chain architecture is used specifically for this event and allows many proofs for the same challenge to coexist on the same ledger. The more important implication of this event is that we cannot know with any certainty the ordering of blocks that reference the same proof. Instead, we assume that all blocks that reference the same challenge ocurred at effectively the same time and then carry this down to tx deduplication, ordering, and double-spending prevention rules.

In the event that any two proofs for the same challenge hash to the same chain at roughly the same time, we have a bona fide fork. However the probability of this event occurring can be made negligible with a properly configured number of chains. Fundamentally, the faster the block propagation time, the more chains we need to maintain the same level of security as a traditional single chain ledger. Moreover, unlike a traditional ledger, we have a notion of solution quality and apply a deterministic fork resolution strategy that can resolve these conflicts much faster.

### Block Confirmation & Encoding 

As the network eventually converges on a single shared past state of the ledger, we can slowly organize blocks into levels, confirm the blocks one by one, confirm the levels, deduplicate the records, and erasure code the new archival state into pieces for farmers to preserve and plot.

We may first organize blocks into levels based on their parent proof. If we assume a single farmer synchronously solving each block in turn, then each level would be comprised of a single block and we can order and stretch all chains in the ledger into a single chain. In the real world scenario where we have multiple farmers solving and receiving updates over an asynchronous network, we will often have multiple solutions referencing the same challenge, which we can simply organize into the same level.

A block is confirmed when it has been 'seen' by each chain on the ledger. Specifically, when each chain contains a block that may trace its lineage back to the block pending confirmation, either through a parent proof or parent content link. Once a block is confirmed we then check to see if all blocks at the same level or index in the block tree are also confirmed. 

Once a level is confirmed we can apply a canonical ordering of blocks (by converting their hash to an integer value), deduplicate  txs across these blocks (as we expect their will be overlap between their tx sets), and canonically order the txs. Once we have the records ordered we simply write them to a binary file, while prefixing each record with its length so that it may be decoded. Once the file reaches the size threshold for erasure coding we apply the Reed-Solomon code, currently with parity shards equal to source shards (127 of 254 in k of m terms). This resulting file is then sliced into 256 x 4096 byte pieces, hashed to a merkle tree, and summarized within a new state block. Each node can apply this encoding locally by simply listening to updates that propagate across the gossip network. 

## Data Flow from Genesis

### Create and Plot the Genesis Piece Set

When starting from genesis, the Ledger must be seeded with some initial data to be used when solving the initial challenges. The data itself is irrelevant, and is currently 127 x 4096 random bytes. The data is erasure coded, s.t. 127 source pieces are used to generate 127 parity pieces. Each piece is content-addressed with its 32 byte SHA-256 hash. These hashes are complied into two index pieces, one for the source pieces and one for the parity pieces. These 256 pieces make up the valid piece set for the initial archival state of the ledger. This state change is summarized in state block (the rough equivalent to a block header in a traditional blockchain) that captures the merkle root of the piece set, the last state block, the index piece ids, and some summary data used for work difficulty resets. A new state block will continue to be generated for roughly every 500kb of records added to the ledger, adding roughly 1 MB of erasure coded pieces that are used for plotting.

When the blockchain is small (as it is at genesis), it is expected that each farmer will plot the entire archival history many times under many different nodes ids. As the ledger grows we would expect each farmer to plot the entire history once, and then eventually for farmers to plot a fraction of the ledger based on their available storage resources.

### Solve the Genesis Challenge

To add a new block to the ledger, a farmer begins by computing the challenge, which is simply the SHA-256 hash of the proof-of-storage included in the last valid block. The challenge becomes the 'target' for an audit of the total piece set. To determine which piece is audited by the challenge, a farmer will find the closest piece to the challenge by the XOR metric of the piece hash (id) to the target, similar to the notion of 'closeness' in Kademlia. In this implementation, farmers store all piece ids in a Red-Black Binary Tree that allows for finding the piece in the tree that has the most common Least Significant Bits to a given target.

The farmer will then pull all encodings of the given piece and evaluate them based on a chunk target. Specifically, the piece target is hashed again and the first 8 bytes are extracted to serve as the chunk target. Each encoding of the piece being audited can then be broken int  4096 / 8 = 512 chunks, which may each be compared to the chunk target. The 'closest' chunk (across all valid chunks on the network) then becomes the 'best' or highest quality solution to the block challenge. The more nodes we have, the more storage we have, the higher the replication factor, and the higher the quality we would expect to receive for a given challenge.

### Form a block from proof & tx content

Once a farmer has a valid solution they can then record that into a `proof` that includes:

1. Challenge: 32 byte hash of the parent proof
2. PieceId: 32 byte hash of the piece being audited
3. Solution: 8 byte best chunk for a valid encoding of the piece
4. StateId: 32 byte hash of the state block where the piece was encoded
5. PieceProof: 248 byte merkle proof of inclusion that shows the piece came from the state block 
6. PublicKey: 48 byte BLS public key used for encoding and signing
7. Signature: 96 byte BLS signature of the proof data with the linked private key

The farmer will then generate a coinbase tx, awarding themselves 1 subspace credit for creating a valid block. They will also run the proof hash through the jump hash function to determine the correct chain to place the block. Finally they will collect all pending valid txs that have not yet been included by a block in its history and form a `content` record that includes:

1. ProofId: 32 byte hash of the above proof
2. ContentId: 32 byte hash of the last blocks content record for the chain this proof hashes to
3. Payload: An array of 32 byte tx hashes that have not yet been seen (including the coinbase)

The `proof`, `content`, and full coinbase `tx` will then be aggregated into a new block for gossiping across the network. The farmer will also attach the associated encoding to the message for proper validation. Since each block has a max size of 4096 bytes, the new block will be between 800 and 4096 bytes based on the number of included txs (with a maximum around 100 per block). The maximum size of a new block and encoding will then be 8k and should propagate to all full nodes in around 300 ms. 

### Validate and Apply the new block

Each node who receives the block will validate the proof against the content and then ensure it is a valid state change to the ledger before applying the update and gossiping across the network.

1. Decode the encoding using the public key in the proof.
2. Does it hash to the same piece id provided in the proof?
3. Fetch the state block referenced in the proof from the state chain.
4. Verify the merkle proof using the merkle root from the state chain, the piece hash and the inclusion proof.
5. Verify the signature matches the public key included in the proof.
6. Hash the proof and verify the content pointer is correct.
7. Verify the content points to the correct chain for the proof by jump hashing.
8. Verify the proof is still valid for that chain (the challenge is not yet seen)
9. Verify all the txs in the proof.
10. Apply the proof to the ledger

For each new valid block that is received and applied the process starts anew using the proof of the new block as the input to the challenge. 

### Confirm Blocks and Encode State

As described earlier, each new block can be organized into levels of the chain. We can eventually confirm each block. Once all blocks for a level are confirmed we can order and deduplicate the records. Once we have sufficient pending state we can erasure code a new piece set and encode a new state block.
