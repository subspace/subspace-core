# Install dependencies
FROM node:12

WORKDIR /code

COPY .npmrc /code/.npmrc
COPY package.json /code/package.json
COPY package-lock.json /code/package-lock.json

RUN ["npm", "ci"]

# Prune dependencies
FROM node:12

WORKDIR /code

COPY --from=0 /code /code

RUN ["npm", "prune", "--production"]

# Build Typescript
FROM node:12

WORKDIR /code

COPY --from=0 /code /code
COPY tsconfig.json /code/tsconfig.json
COPY tslint.json /code/tslint.json
COPY src /code/src

RUN ["npm", "run", "build"]

# Build final image
FROM node:12

WORKDIR /code

COPY --from=1 /code /code
COPY --from=2 /code/dist /code/dist
COPY bin /code/bin

ENTRYPOINT ["bin/subspace.js"]
