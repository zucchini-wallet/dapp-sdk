mod incoming;
// Viewing-only compact-block scanner. No seed import, transaction builder or broadcast path.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::{self, Cursor, Read},
    time::Duration,
};
use zcash_client_backend::{
    TransferType,
    proto::service::{
        BlockId, BlockRange, ChainSpec, Empty, TxFilter,
        compact_tx_streamer_client::CompactTxStreamerClient,
    },
    scanning::{Nullifiers, scan_block},
};
use zcash_keys::{address::Address, keys::UnifiedIncomingViewingKey};
use zcash_primitives::transaction::Transaction;
use zcash_protocol::{
    consensus::{BlockHeight, BranchId, Network},
    memo::Memo,
};
use zeroize::Zeroizing;
type Result<T> = std::result::Result<T, Box<dyn std::error::Error + Send + Sync>>;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    endpoint: String,
    network: String,
    viewing_key_file: String,
    from: u32,
    limit: u32,
    recipients: Vec<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Receipt {
    txid: String,
    pool: String,
    output_index: usize,
    recipient: String,
    amount_zatoshis: String,
    memo: String,
    block_height: u32,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Block {
    height: u32,
    hash: String,
    previous_hash: String,
    receipts: Vec<Receipt>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Batch {
    network: String,
    tip_height: u32,
    tip_hash: String,
    anchor_hash: String,
    blocks: Vec<Block>,
}
fn hash(bytes: &[u8]) -> Result<String> {
    if bytes.len() != 32 {
        return Err("Invalid block hash".into());
    }
    Ok(bytes.iter().rev().map(|b| format!("{b:02x}")).collect())
}
fn secret(path: &str) -> Result<Zeroizing<String>> {
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.is_file() || metadata.len() > 8192 {
        return Err("Invalid viewing-key file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err("Viewing-key file must have mode 600".into());
        }
    }
    Ok(Zeroizing::new(fs::read_to_string(path)?))
}
fn raw_transaction(raw: &[u8], height: u32, network: Network, txid: &str) -> Result<Transaction> {
    if raw.is_empty() || raw.len() > 2 * 1024 * 1024 {
        return Err("Invalid transaction length".into());
    }
    let mut cursor = Cursor::new(raw);
    let tx = Transaction::read(
        &mut cursor,
        BranchId::for_height(&network, BlockHeight::from_u32(height)),
    )?;
    if cursor.position() != raw.len() as u64 || tx.txid().to_string() != txid {
        return Err("Transaction identity or encoding mismatch".into());
    }
    Ok(tx)
}
fn receipts(
    tx: &Transaction,
    height: u32,
    network: Network,
    keys: &HashMap<u32, UnifiedIncomingViewingKey>,
    recipients: &[(String, Address)],
) -> Vec<Receipt> {
    let decrypted = incoming::decrypt(&network, BlockHeight::from_u32(height), tx, keys);
    let mut result = vec![];
    for output in decrypted.sapling_outputs() {
        if output.transfer_type() != TransferType::Incoming {
            continue;
        }
        let Ok(Memo::Text(memo)) = Memo::try_from(output.memo()) else {
            continue;
        };
        for (encoded, address) in recipients {
            let receiver = match address {
                Address::Sapling(p) => Some(p),
                Address::Unified(ua) => ua.sapling(),
                _ => None,
            };
            if receiver == Some(&output.note().recipient()) {
                result.push(Receipt {
                    txid: tx.txid().to_string(),
                    pool: "sapling".into(),
                    output_index: output.index(),
                    recipient: encoded.clone(),
                    amount_zatoshis: u64::from(output.note_value()).to_string(),
                    memo: memo.to_string(),
                    block_height: height,
                });
            }
        }
    }
    for (pool, outputs) in [
        ("orchard", decrypted.orchard_outputs()),
        ("ironwood", decrypted.ironwood_outputs()),
    ] {
        for output in outputs {
            if output.transfer_type() != TransferType::Incoming {
                continue;
            }
            let Ok(Memo::Text(memo)) = Memo::try_from(output.memo()) else {
                continue;
            };
            for (encoded, address) in recipients {
                if let Address::Unified(ua) = address {
                    if ua.orchard() == Some(&output.note().0.recipient()) {
                        result.push(Receipt {
                            txid: tx.txid().to_string(),
                            pool: pool.into(),
                            output_index: output.index(),
                            recipient: encoded.clone(),
                            amount_zatoshis: output.note().0.value().inner().to_string(),
                            memo: memo.to_string(),
                            block_height: height,
                        });
                    }
                }
            }
        }
    }
    result
}
async fn run(c: Config) -> Result<Batch> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    if !c.endpoint.starts_with("https://")
        || c.from == 0
        || !(1..=100).contains(&c.limit)
        || c.recipients.is_empty()
        || c.recipients.len() > 100
    {
        return Err("Invalid scanner configuration".into());
    }
    let network = match c.network.as_str() {
        "mainnet" => Network::MainNetwork,
        "testnet" => Network::TestNetwork,
        _ => return Err("Invalid network".into()),
    };
    let encoded = secret(&c.viewing_key_file)?;
    let incoming = incoming::decode(&network, encoded.trim())?;
    let scanning = incoming::scanning_keys(&incoming);
    let keys = HashMap::from([(0u32, incoming.clone())]);
    let recipients = c
        .recipients
        .iter()
        .map(|s| {
            Address::decode(&network, s)
                .map(|a| (s.clone(), a))
                .ok_or("Invalid recipient")
        })
        .collect::<std::result::Result<Vec<_>, _>>()?;
    for (_, address) in &recipients {
        let owned = match address {
            Address::Sapling(a) => incoming
                .sapling()
                .as_ref()
                .is_some_and(|k| k.decrypt_diversifier(a).is_some()),
            Address::Unified(ua) => {
                (ua.sapling().is_some() || ua.orchard().is_some())
                    && ua.sapling().is_none_or(|a| {
                        incoming
                            .sapling()
                            .as_ref()
                            .is_some_and(|k| k.decrypt_diversifier(a).is_some())
                    })
                    && ua.orchard().is_none_or(|a| {
                        incoming
                            .orchard()
                            .as_ref()
                            .is_some_and(|k| k.diversifier_index(a).is_some())
                    })
            }
            _ => false,
        };
        if !owned {
            return Err("Viewing key does not own every shielded recipient".into());
        }
    }
    let mut client = CompactTxStreamerClient::connect(c.endpoint)
        .await?
        .max_decoding_message_size(4 * 1024 * 1024);
    let info = client.get_lightd_info(Empty {}).await?.into_inner();
    if info.chain_name
        != if c.network == "testnet" {
            "test"
        } else {
            "main"
        }
    {
        return Err("Server network mismatch".into());
    }
    let latest = client.get_latest_block(ChainSpec {}).await?.into_inner();
    let tip = u32::try_from(latest.height)?;
    let anchor = client
        .get_block(BlockId {
            height: u64::from((c.from - 1).min(tip)),
            hash: vec![],
        })
        .await?
        .into_inner();
    if anchor.height != u64::from((c.from - 1).min(tip)) {
        return Err("Anchor height mismatch".into());
    }
    let mut previous = hash(&anchor.hash)?;
    let anchor_hash = previous.clone();
    let mut blocks = vec![];
    let end = c.from.saturating_add(c.limit - 1).min(tip);
    if c.from <= tip {
        let mut stream = client
            .get_block_range(BlockRange {
                start: Some(BlockId {
                    height: c.from.into(),
                    hash: vec![],
                }),
                end: Some(BlockId {
                    height: end.into(),
                    hash: vec![],
                }),
                pool_types: vec![],
            })
            .await?
            .into_inner();
        let mut prior = None;
        while let Some(block) = stream.message().await? {
            let height = c.from + u32::try_from(blocks.len())?;
            if height > end
                || block.height != u64::from(height)
                || hash(&block.prev_hash)? != previous
            {
                return Err("Compact block continuity mismatch".into());
            }
            let block_hash = hash(&block.hash)?;
            let scanned = scan_block(
                &network,
                block,
                &scanning,
                &Nullifiers::empty(),
                prior.as_ref(),
            )?;
            prior = Some(scanned.to_block_metadata());
            let mut found = vec![];
            for candidate in scanned.transactions() {
                let id = candidate.txid();
                let raw = client
                    .get_transaction(TxFilter {
                        block: None,
                        index: 0,
                        hash: id.as_ref().to_vec(),
                    })
                    .await?
                    .into_inner();
                if raw.height != u64::from(height) {
                    return Err("Transaction moved during scan".into());
                }
                let tx = raw_transaction(&raw.data, height, network, &id.to_string())?;
                found.extend(receipts(&tx, height, network, &keys, &recipients));
            }
            blocks.push(Block {
                height,
                hash: block_hash.clone(),
                previous_hash: previous,
                receipts: found,
            });
            previous = block_hash;
        }
        if blocks.len() != usize::try_from(end - c.from + 1)? {
            return Err("Incomplete block range".into());
        }
    }
    // Bind the result to a stable provider tip; a concurrent tip change is retried, never accepted as paid.
    let last = client.get_latest_block(ChainSpec {}).await?.into_inner();
    if last.height != latest.height || last.hash != latest.hash {
        return Err("Chain tip changed during scan; retry".into());
    }
    if end == tip && previous != hash(&latest.hash)? {
        return Err("Scan does not reach canonical tip".into());
    }
    Ok(Batch {
        network: c.network,
        tip_height: tip,
        tip_hash: hash(&latest.hash)?,
        anchor_hash,
        blocks,
    })
}
#[tokio::main]
async fn main() {
    if std::env::args().nth(1).as_deref() == Some("--testnet-tip") {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let result = tokio::time::timeout(Duration::from_secs(20), async {
            let mut client =
                CompactTxStreamerClient::connect("https://testnet.zec.rocks:443").await?;
            let info = client.get_lightd_info(Empty {}).await?.into_inner();
            if info.chain_name != "test" {
                return Err::<u64, Box<dyn std::error::Error + Send + Sync>>(
                    "Wrong network".into(),
                );
            }
            Ok(client
                .get_latest_block(ChainSpec {})
                .await?
                .into_inner()
                .height)
        })
        .await;
        match result {
            Ok(Ok(height)) => println!("{height}"),
            _ => {
                eprintln!("Testnet height unavailable");
                std::process::exit(1);
            }
        }
        return;
    }
    let result: Result<Batch> = async {
        let mut input = String::new();
        io::stdin().take(65537).read_to_string(&mut input)?;
        if input.len() > 65536 {
            return Err("Configuration too large".into());
        }
        let config = serde_json::from_str(&input)?;
        tokio::time::timeout(Duration::from_secs(90), run(config)).await?
    }
    .await;
    match result {
        Ok(batch) => println!(
            "{}",
            serde_json::to_string(&batch).expect("serializable batch")
        ),
        Err(error) => {
            let reason = error.to_string();
            // Expose only fixed local diagnostics, never provider errors or key contents.
            if ["Viewing key does not own every shielded recipient", "Invalid viewing key or network", "Server network mismatch", "Chain tip changed during scan; retry"].contains(&reason.as_str()) {
                eprintln!("{reason}");
            }
            eprintln!(
                "Receipt scan failed; check configuration, key permissions, provider availability and chain continuity. No receipt was confirmed."
            );
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_wrong_transaction_identity_and_bad_encodings() {
        for bytes in [vec![], vec![0; 32], vec![0; 2 * 1024 * 1024 + 1]] {
            assert!(
                raw_transaction(&bytes, 3_000_000, Network::TestNetwork, &"a".repeat(64)).is_err()
            );
        }
    }
    #[test]
    fn block_hashes_use_wire_byte_order_and_require_full_width() {
        let mut bytes = [0u8; 32];
        bytes[0] = 1;
        assert_eq!(hash(&bytes).unwrap(), format!("{}01", "00".repeat(31)));
        assert!(hash(&bytes[..31]).is_err());
    }
    #[test]
    fn decrypts_real_sapling_ciphertext_and_binds_receiver_memo_amount_and_txid() {
        use sapling::{
            Rseed,
            bundle::{Authorized as SaplingAuthorized, Bundle, OutputDescription},
            note_encryption::{SaplingDomain, sapling_note_encryption},
            value::{NoteValue, ValueCommitTrapdoor, ValueCommitment},
        };
        use zcash_keys::keys::UnifiedSpendingKey;
        use zcash_note_encryption::Domain;
        use zcash_primitives::transaction::{Authorized, TransactionData, TxVersion};
        use zcash_protocol::{memo::MemoBytes, value::ZatBalance};
        let network = Network::TestNetwork;
        let height = 3_000_000;
        let key = UnifiedSpendingKey::from_seed(&network, &[7; 32], zip32::AccountId::ZERO)
            .unwrap()
            .to_unified_full_viewing_key();
        let (_, address) = key.sapling().unwrap().default_address();
        let value = NoteValue::from_raw(100_000);
        let note = address.create_note(value, Rseed::AfterZip212([42; 32]));
        let mut rng = rand::rng();
        let cv = ValueCommitment::derive(value, ValueCommitTrapdoor::random(&mut rng));
        let cmu = note.cmu();
        let memo = MemoBytes::from_bytes(b"zucchini:fixture-1").unwrap();
        let encryption = sapling_note_encryption(None, note, *memo.as_array(), &mut rng);
        let output = OutputDescription::from_parts(
            cv,
            cmu,
            SaplingDomain::epk_bytes(encryption.epk()),
            encryption.encrypt_note_plaintext(),
            [0; 80],
            [0; 192],
        );
        // Dummy authorization/proof bytes make this a decryption fixture, never a broadcastable payment.
        let bundle = Bundle::from_parts(
            vec![],
            vec![output],
            ZatBalance::from_i64(-100_000).unwrap(),
            SaplingAuthorized {
                binding_sig: [0; 64].into(),
            },
        );
        let tx = TransactionData::<Authorized>::from_parts(
            TxVersion::V5,
            BranchId::for_height(&network, BlockHeight::from_u32(height)),
            0,
            BlockHeight::from_u32(height + 100),
            None,
            None,
            bundle,
            None,
        )
        .freeze()
        .unwrap();
        let target = Address::Sapling(address);
        let encoded = target.encode(&network);
        let keys = HashMap::from([(0u32, key.to_unified_incoming_viewing_key())]);
        let result = receipts(&tx, height, network, &keys, &[(encoded.clone(), target)]);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].amount_zatoshis, "100000");
        assert_eq!(result[0].memo, "zucchini:fixture-1");
        assert_eq!(result[0].recipient, encoded);
        let other = UnifiedSpendingKey::from_seed(&network, &[8; 32], zip32::AccountId::ZERO)
            .unwrap()
            .to_unified_full_viewing_key();
        let (_, wrong) = other.sapling().unwrap().default_address();
        let wrong = Address::Sapling(wrong);
        assert!(
            receipts(
                &tx,
                height,
                network,
                &keys,
                &[(wrong.encode(&network), wrong)]
            )
            .is_empty()
        );
        let mut raw = vec![];
        tx.write(&mut raw).unwrap();
        assert!(raw_transaction(&raw, height, network, &tx.txid().to_string()).is_ok());
        assert!(raw_transaction(&raw, height, network, &"a".repeat(64)).is_err());
        raw.push(0);
        assert!(raw_transaction(&raw, height, network, &tx.txid().to_string()).is_err());
    }
    #[test]
    fn decrypts_real_orchard_ciphertext_to_exact_unified_receiver() {
        use orchard::{
            Action, Anchor, Note, Proof,
            bundle::{Authorized as OrchardAuthorized, Bundle, BundleVersion, Flags},
            note::{
                ExtractedNoteCommitment, NoteVersion, Nullifier, RandomSeed, Rho,
                TransmittedNoteCiphertext,
            },
            note_encryption::{OrchardDomain, OrchardNoteEncryption},
            primitives::redpallas,
            value::{NoteValue, ValueCommitTrapdoor, ValueCommitment},
        };
        use zcash_keys::{address::UnifiedAddress, keys::UnifiedSpendingKey};
        use zcash_note_encryption::Domain;
        use zcash_primitives::transaction::{Authorized, TransactionData, TxVersion};
        use zcash_protocol::{memo::MemoBytes, value::ZatBalance};
        let network = Network::TestNetwork;
        let height = 3_000_000;
        let key = UnifiedSpendingKey::from_seed(&network, &[7; 32], zip32::AccountId::ZERO)
            .unwrap()
            .to_unified_full_viewing_key();
        let receiver = key
            .orchard()
            .unwrap()
            .address_at(0u32, zip32::Scope::External);
        let nf = Nullifier::from_bytes(&[0; 32]).unwrap();
        let rho = Rho::from_bytes(&nf.to_bytes()).unwrap();
        let note = Note::from_parts(
            receiver,
            NoteValue::from_raw(100_000),
            rho,
            RandomSeed::from_bytes([9; 32], &rho).unwrap(),
            NoteVersion::V2,
        )
        .unwrap();
        let cmx = ExtractedNoteCommitment::from(note.commitment());
        let enc = OrchardNoteEncryption::new(
            None,
            note,
            *MemoBytes::from_bytes(b"zucchini:orchard-fixture")
                .unwrap()
                .as_array(),
        );
        let ciphertext = TransmittedNoteCiphertext {
            epk_bytes: OrchardDomain::epk_bytes(enc.epk()).0,
            enc_ciphertext: enc.encrypt_note_plaintext(),
            out_ciphertext: [0; 80],
        };
        let signing = redpallas::SigningKey::<redpallas::SpendAuth>::try_from([1; 32]).unwrap();
        let cv = ValueCommitment::derive(
            NoteValue::from_raw(0) - NoteValue::from_raw(100_000),
            ValueCommitTrapdoor::from_bytes([0; 32]).unwrap(),
        );
        let action =
            Action::from_parts(nf, (&signing).into(), cmx, ciphertext, cv, [0; 64].into()).unwrap();
        let bundle = Bundle::try_from_parts(
            nonempty::NonEmpty::new(action),
            Flags::ENABLED,
            ZatBalance::from_i64(-100_000).unwrap(),
            Anchor::empty_tree(),
            OrchardAuthorized::from_parts(
                Proof::new(vec![0; Proof::expected_proof_size(1)]),
                [0; 64].into(),
            ),
            BundleVersion::orchard_v2(),
        )
        .unwrap();
        let tx = TransactionData::<Authorized>::from_parts(
            TxVersion::V5,
            BranchId::for_height(&network, BlockHeight::from_u32(height)),
            0,
            BlockHeight::from_u32(height + 100),
            None,
            None,
            None,
            Some(bundle),
        )
        .freeze()
        .unwrap();
        let ua =
            Address::Unified(UnifiedAddress::from_receivers(Some(receiver), None, None).unwrap());
        let encoded = ua.encode(&network);
        let targets = [(encoded.clone(), ua)];
        let keys = HashMap::from([(0u32, key.to_unified_incoming_viewing_key())]);
        let found = receipts(&tx, height, network, &keys, &targets);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].pool, "orchard");
        assert_eq!(found[0].amount_zatoshis, "100000");
        assert_eq!(found[0].memo, "zucchini:orchard-fixture");
        assert_eq!(found[0].recipient, encoded);
        let wrong = UnifiedSpendingKey::from_seed(&network, &[8; 32], zip32::AccountId::ZERO)
            .unwrap()
            .to_unified_full_viewing_key();
        assert!(
            receipts(
                &tx,
                height,
                network,
                &HashMap::from([(0u32, wrong.to_unified_incoming_viewing_key())]),
                &targets
            )
            .is_empty()
        );
        let mut raw = vec![];
        tx.write(&mut raw).unwrap();
        assert!(raw_transaction(&raw, height, network, &tx.txid().to_string()).is_ok());
    }
    #[test]
    fn decrypts_real_ironwood_ciphertext_to_rotated_unified_receiver() {
        use orchard::{
            Action, Anchor, Note, Proof,
            bundle::{Authorized as OrchardAuthorized, Bundle, BundleVersion, Flags},
            note::{
                ExtractedNoteCommitment, NoteVersion, Nullifier, RandomSeed, Rho,
                TransmittedNoteCiphertext,
            },
            note_encryption::{IronwoodDomain, IronwoodNoteEncryption},
            primitives::redpallas,
            value::{NoteValue, ValueCommitTrapdoor, ValueCommitment},
        };
        use zcash_keys::{address::UnifiedAddress, keys::UnifiedSpendingKey};
        use zcash_note_encryption::Domain;
        use zcash_primitives::transaction::{Authorized, TransactionData};
        use zcash_protocol::{memo::MemoBytes, value::ZatBalance};
        let network = Network::TestNetwork;
        let height = 4_500_000;
        let key = UnifiedSpendingKey::from_seed(&network, &[7; 32], zip32::AccountId::ZERO)
            .unwrap()
            .to_unified_full_viewing_key();
        let receiver = key
            .orchard()
            .unwrap()
            .address_at(19u32, zip32::Scope::External);
        let nf = Nullifier::from_bytes(&[0; 32]).unwrap();
        let rho = Rho::from_bytes(&nf.to_bytes()).unwrap();
        let note = Note::from_parts(
            receiver,
            NoteValue::from_raw(100_000),
            rho,
            RandomSeed::from_bytes([9; 32], &rho).unwrap(),
            NoteVersion::V3,
        )
        .unwrap();
        let cmx = ExtractedNoteCommitment::from(note.commitment());
        let enc = IronwoodNoteEncryption::new(
            None,
            note,
            *MemoBytes::from_bytes(b"zucchini:ironwood-fixture")
                .unwrap()
                .as_array(),
        );
        let ciphertext = TransmittedNoteCiphertext {
            epk_bytes: IronwoodDomain::epk_bytes(enc.epk()).0,
            enc_ciphertext: enc.encrypt_note_plaintext(),
            out_ciphertext: [0; 80],
        };
        let signing = redpallas::SigningKey::<redpallas::SpendAuth>::try_from([1; 32]).unwrap();
        let cv = ValueCommitment::derive(
            NoteValue::from_raw(0) - NoteValue::from_raw(100_000),
            ValueCommitTrapdoor::from_bytes([0; 32]).unwrap(),
        );
        let action =
            Action::from_parts(nf, (&signing).into(), cmx, ciphertext, cv, [0; 64].into()).unwrap();
        let bundle = Bundle::try_from_parts(
            nonempty::NonEmpty::new(action),
            Flags::ENABLED,
            ZatBalance::from_i64(-100_000).unwrap(),
            Anchor::empty_tree(),
            OrchardAuthorized::from_parts(
                Proof::new(vec![0; Proof::expected_proof_size(1)]),
                [0; 64].into(),
            ),
            BundleVersion::ironwood_v3(),
        )
        .unwrap();
        let tx = TransactionData::<Authorized>::from_parts_v6(
            BranchId::for_height(&network, BlockHeight::from_u32(height)),
            0,
            BlockHeight::from_u32(height + 100),
            None,
            None,
            None,
            Some(bundle),
        )
        .freeze()
        .unwrap();
        let ua =
            Address::Unified(UnifiedAddress::from_receivers(Some(receiver), None, None).unwrap());
        let encoded = ua.encode(&network);
        let targets = [(encoded.clone(), ua)];
        let keys = HashMap::from([(0u32, key.to_unified_incoming_viewing_key())]);
        let found = receipts(&tx, height, network, &keys, &targets);
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].pool, "ironwood");
        assert_eq!(found[0].amount_zatoshis, "100000");
        assert_eq!(found[0].memo, "zucchini:ironwood-fixture");
        assert_eq!(found[0].recipient, encoded);
        let wrong = UnifiedSpendingKey::from_seed(&network, &[8; 32], zip32::AccountId::ZERO)
            .unwrap()
            .to_unified_full_viewing_key();
        assert!(
            receipts(
                &tx,
                height,
                network,
                &HashMap::from([(0u32, wrong.to_unified_incoming_viewing_key())]),
                &targets
            )
            .is_empty()
        );
        let mut raw = vec![];
        tx.write(&mut raw).unwrap();
        assert!(raw_transaction(&raw, height, network, &tx.txid().to_string()).is_ok());
    }
    #[tokio::test]
    #[ignore = "Read-only public testnet provider check; no wallet keys or funds"]
    async fn live_testnet_provider_scans_compact_blocks() {
        use zcash_keys::keys::{UnifiedAddressRequest, UnifiedSpendingKey};
        let _ = rustls::crypto::ring::default_provider().install_default();
        let endpoint = "https://testnet.zec.rocks:443";
        let mut client = CompactTxStreamerClient::connect(endpoint).await.unwrap();
        let tip = client
            .get_latest_block(ChainSpec {})
            .await
            .unwrap()
            .into_inner()
            .height;
        let network = Network::TestNetwork;
        let key = UnifiedSpendingKey::from_seed(&network, &[63; 32], zip32::AccountId::ZERO)
            .unwrap()
            .to_unified_full_viewing_key();
        let (address, _) = key
            .default_address(UnifiedAddressRequest::AllAvailableKeys)
            .unwrap();
        let path = std::env::temp_dir().join(format!("merchant-probe-{}.key", std::process::id()));
        use std::io::Write;
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&path)
            .unwrap();
        file.write_all(key.to_unified_incoming_viewing_key().encode(&network).as_bytes()).unwrap();
        drop(file);
        let result = run(Config {
            endpoint: endpoint.into(),
            network: "testnet".into(),
            viewing_key_file: path.to_str().unwrap().into(),
            from: tip as u32 - 1,
            limit: 2,
            recipients: vec![address.encode(&network)],
        })
        .await;
        fs::remove_file(path).unwrap();
        let batch = result.unwrap();
        assert_eq!(batch.blocks.len(), 2);
        assert!(batch.blocks.iter().all(|b| b.receipts.is_empty()));
    }
    #[test]
    fn configuration_rejects_unknown_fields() {
        assert!(serde_json::from_str::<Config>(r#"{"endpoint":"https://example.com","network":"testnet","viewingKeyFile":"key","from":1,"limit":10,"recipients":[],"mnemonic":"secret"}"#).is_err());
    }
    #[test]
    fn secret_reader_rejects_public_files_and_symlinks() {
        #[cfg(unix)]
        {
            use std::os::unix::fs::{PermissionsExt, symlink};
            let dir =
                std::env::temp_dir().join(format!("merchant-key-test-{}", std::process::id()));
            fs::create_dir_all(&dir).unwrap();
            let key = dir.join("key");
            fs::write(&key, "test-only-not-a-key").unwrap();
            fs::set_permissions(&key, fs::Permissions::from_mode(0o644)).unwrap();
            assert!(secret(key.to_str().unwrap()).is_err());
            fs::set_permissions(&key, fs::Permissions::from_mode(0o600)).unwrap();
            assert!(secret(key.to_str().unwrap()).is_ok());
            let link = dir.join("link");
            symlink(&key, &link).unwrap();
            assert!(secret(link.to_str().unwrap()).is_err());
            fs::remove_file(link).unwrap();
            fs::remove_file(key).unwrap();
            fs::remove_dir(dir).unwrap();
        }
    }
}
