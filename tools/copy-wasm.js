const fs = require('fs');

const files = [
    'node_modules/@subspace/bls-signatures/blsjs.wasm',
    'node_modules/@subspace/reed-solomon-erasure.wasm/dist/reed_solomon_erasure_bg.wasm',
];

for (const file of files) {
    fs.copyFileSync(
        `${__dirname}/../${file}`,
        `${__dirname}/../app/web/build/${file.split('/').pop()}`,
    );
}
