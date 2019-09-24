## Single Node Testing

Clone and build the repo.

### Node JS

Start a new genesis node. If there is not another genesis node on the same network, the node will crash.

```bash
./bin/subspace.js run -g 
```

Start with more advanced options

```bash
./bin/subspace.js run -g -t -r -c 32 -p 100 -f memory
```
* Genesis Node
* Trusted mode (does not validate records -- faster)
* Reset (wipes disk on startup)
* 32 chains
* 100 plots (each new piece is plotted 100 times)
* Memory plotting

## Browser

```bash
npm run test-browser
```

Open a browser tab with specified local port.

Open up the dev tools and go to console.

Click [start single node]() button.

You should see output in the console.

Right now these setting must be changed manually at the bottom of `index.html`.


## Local Network Testing

> All nodes must have the same number of chains, be on the same network, and have the same encoding rounds.
> If you don't change anything this will happen automatically through defaults.

### Node JS

Startup the genesis/gateway node.

```bash
./bin/subspace.js run -g -w 1000 -c 16
```

Startup a validator node

```bash
./bin/subspace.js run -m validator -c 16
```

### Browser

Startup a browser validator node

Click [Join Local Network]()

It should connect to the first node that was spun up.


Startup a farmer (it will crash soon...)

```bash
./bin/subspace.js run -m farmer -c 16 -w 1000
```

## AWS Testnet 


### Gateway Node Setup

> Note -- the Gateway node is already setup -- you just need to SSH into it and run a gateway.
> These instructions are for first-time setup only.

Create a new EC2 Instance from the AWS Console. Choose an existing key or create a new one. On creation you must download the private key to your local machine, as it will not be saved by AWS. 

Add permission to the key.
```bash
cd /dir/where/key/is
chmod 400 gateway.pem 
```

Remote into the instance.
```bash
ssh -i "gateway.pem" ubuntu@ec2-54-191-145-133.us-west-2.compute.amazonaws.com
```

Configure the server
```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.34.0/install.sh | bash
. ~/.nvm/nvm.sh
nvm install node
node -e "console.log('Running Node.js ' + process.version)"

```

Setup the repository
```bash
git clone https://www.github.com/subspace/subspace-core.git
cd subspace-core
npm ci
npm test
npm run build
```

### Start the Gateway

Once you have remoted in to the Gateway Node:
```bash
./bin/subspace.js run -g -n test -c 16 -w 1000
```

On your local machine

```bash
./bin/subspace.js run -m validator -n test -c 16
```

### Browser

Click [Join Test Network]() button.