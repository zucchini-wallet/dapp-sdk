# Incoming-only merchant receipt scanner

The standalone scanner accepts a local unified incoming viewing key (UIVK).
It decrypts external incoming notes only and cannot spend or recover outgoing
payments. A UFVK is accepted for compatibility and reduced to incoming authority.
Keep the key private: it covers the account, not just merchant invoices.

Compact scanning identifies candidate transactions. The scanner fetches their
full bytes, checks the transaction ID, decrypts notes locally, and compares the
exact shielded receiver, amount, and memo. It supports Sapling, Orchard and
Ironwood extraction. Sapling and Orchard have encrypted-fixture regression tests;
Ironwood funded acceptance remains a separate gate. The service relies on its
lightwallet provider for canonical-chain information, as a light wallet does.

## Build and setup

```sh
cargo build --release --locked --manifest-path receipt-scanner/Cargo.toml
python3 receipt-scanner/setup.py --viewing-key /absolute/path/merchant.viewing-key
```

Export from your existing wallet's Security & recovery screen. Setup copies it
into a mode-600 file in a mode-700 directory. The original downloaded file remains
your responsibility. The scanner has no Apple or wallet-core dependencies.
The optional offline backup export tool now lives in wallet-core/tools/merchant-key-export.

See [the merchant guide](../docs/merchant-setup.md) for keys, registry onboarding,
scan birthdays, webhook configuration and testnet acceptance.

The reference collector is a testnet demo integration, not a production hosted
service. Keep it running; stale scans never authorize fulfillment. It uses a
public lightwalletd provider rather than operating a full node. Encrypted fixtures
cover Sapling, Orchard and Ironwood (including a rotated receiver); funded
end-to-end acceptance remains required.
