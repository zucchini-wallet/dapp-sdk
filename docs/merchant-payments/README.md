# Open Zcash merchant payments

The specification, independent verifier, registry tooling and reference checkout
now live in [zucchini-wallet/open-zcash-merchant-payments](https://github.com/zucchini-wallet/open-zcash-merchant-payments).

This SDK adds experimental `/merchant` and `/merchant/server` entry points.
See the [integration guide](https://github.com/zucchini-wallet/open-zcash-merchant-payments/blob/main/docs/sdk-integration.md).

The independent library is currently pinned as a local vendor tarball. Publish
that package and replace the file dependency with an exact registry version before
publishing this SDK. No production wallet capability is advertised yet.
