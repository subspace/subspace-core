# Install production dependencies for target architecture
FROM subspacelabs/node:12-dev

COPY .npmrc /code
COPY package.json /code
COPY package-lock.json /code

COPY docker/install-production-dependencies.sh /install-production-dependencies.sh

RUN ["/install-production-dependencies.sh"]

# Build TypeScript with amd64 image for better performance
FROM subspacelabs/node:12

COPY .npmrc /code
COPY package.json /code
COPY package-lock.json /code

RUN ["npm", "ci"]

COPY src /code/src
COPY types /code/types
COPY tsconfig.json /code
COPY tslint.json /code

RUN ["npm", "run", "build"]

# Build final image without build-time dependencies
FROM subspacelabs/node:12

COPY docker/entrypoint.sh /entrypoint.sh

COPY bin /code/bin
COPY --from=1 /code/dist /code/dist
COPY --from=0 /code/node_modules /code/node_modules
COPY package.json /code
COPY package-lock.json /code

ENTRYPOINT ["/entrypoint.sh"]
