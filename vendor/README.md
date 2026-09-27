# Bundled merchant verifier

`zucchinifi-merchant-payments-0.1.0-alpha.1-0b69276.tgz` is built from
https://github.com/zucchini-wallet/open-zcash-merchant-payments at source commit
`0b69276f031b2e3e615e11c8ff296442407513b5`. The lockfile pins its integrity.

Development uses a pnpm file override. The npm SDK includes the protocol as a
bundled dependency, with its original licenses; consumers do not need a sibling
repository or local tarball path. `pnpm verify:package` verifies this by installing
the actual packed SDK into a fresh external npm project and importing all exports.

The protocol remains experimental. Bundling its verifier does not enable signed
merchant payments in the production wallet. Preserve upstream license notices
when updating the pin and rerun package and protocol tests.
