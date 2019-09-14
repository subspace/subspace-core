## Gateway Testing

Download the private key file from AWS and add permissions
Then remote in

```bash
cd /dir/where/key/is
chmod 400 gateway.pem 
ssh -i "gateway.pem" ubuntu@ec2-54-191-145-133.us-west-2.compute.amazonaws.com
````

Configure the server
```
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.34.0/install.sh | bash
. ~/.nvm/nvm.sh
nvm install node
node -e "console.log('Running Node.js ' + process.version)"

```

Setup the repo
```
git clone https://www.github.com/subspace/subspace-core.git
cd subspace-core
npm ci
npm test
npm run build
```

Start the Gateway
```
npx ts-node src/main/tests/awsGatewayNode.ts
```