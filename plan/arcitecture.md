
# Architecture

IOU is a peer-to-peer mobile web app, that uses Node.js backend to initiate connections between clients.


## Data

Application data is stored in peer-to-peer network where each client keeps its own data and updates it according to messages reveived from its peers. Each node in the network only needs to know its own state in relation to its peers and thus there is no need for globally shared data (e.g. blockchain) between all participants.

## Client

Client is a modularly designed mobile web application.

Technologies used:
- IndexedDb for storing application data
- SubtleCrypto Web API for security
- Progressive web app tehconologies (Web application manifest, Web Workers, etc.) to allow native like features.


## Relay bakckends

Node.js backend, that has two main functions: to serve client files and initiate peer-to-peer WebRTC connections between clients. These functionalities should be kept separete since later they may be split into two different servers. Backends may also be used to cache messages for clients that are offline at the time of sending the message. To keep application decentralized there can be many backends / relay servers, and client can choose in its settings to which servers to connect to.

