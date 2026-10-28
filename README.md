# CRM connectors

Each CRM connector lives in its own directory with its implementation, tests, and setup instructions.

- [Twenty](./twenty/README.md): resolve newly created companies by name and create linked managing directors as People, or look up company details by Firmenbuchnummer.

Keep connectors independent. Extract shared utilities when multiple connectors need the same behavior.

Licensed under [FSL-1.1-Apache-2.0](./LICENSE.md), the same license used by the other firmafind integration packages.
