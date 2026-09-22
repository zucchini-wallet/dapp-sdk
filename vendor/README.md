# Merchant verifier development pin

`zucchinifi-merchant-payments-0.1.0-alpha.1-0b69276.tgz` is built from the local
`../open-zcash-merchant-payments` sibling repository. Source commit: `0b69276f031b2e3e615e11c8ff296442407513b5`. The lockfile pins its integrity.
This is for development before the independent package is published.

Do not publish this SDK with a local file dependency. Publish the verified library
first, replace the file dependency with its exact npm version, and rerun tests.
No package publication is performed by this change.
