//! External incoming-only scanning. No outgoing recovery or nullifier derivation.
use incrementalmerkletree::Position;
use orchard::note_encryption::{
    DomainVersion, IronwoodVersion, NoteEncryptionDomain, OrchardVersion,
};
use sapling::note_encryption::SaplingDomain;
use std::collections::HashMap;
use zcash_client_backend::{
    DecryptedOutput, TransferType,
    data_api::DecryptedTransaction,
    scanning::{ScanningKey, ScanningKeyOps, ScanningKeys},
};
use zcash_keys::keys::{UnifiedFullViewingKey, UnifiedIncomingViewingKey};
use zcash_note_encryption::try_note_decryption;
use zcash_primitives::transaction::{Transaction, components::sapling::zip212_enforcement};
use zcash_protocol::{
    ShieldedPool,
    consensus::{BlockHeight, Network},
    memo::MemoBytes,
};

pub fn decode(network: &Network, encoded: &str) -> crate::Result<UnifiedIncomingViewingKey> {
    // Existing UFVK configurations remain readable, but only their external incoming
    // capability enters the scanner. New exports use UIVK.
    let key = UnifiedIncomingViewingKey::decode(network, encoded)
        .or_else(|_| {
            UnifiedFullViewingKey::decode(network, encoded)
                .map(|k| k.to_unified_incoming_viewing_key())
        })
        .map_err(|_| "Invalid viewing key or network")?;
    if !key.has_sapling() && !key.has_orchard() {
        return Err("A shielded incoming viewing key is required".into());
    }
    Ok(key)
}

struct SaplingKey(sapling::zip32::IncomingViewingKey);
impl ScanningKeyOps<SaplingDomain, u32, sapling::Nullifier> for SaplingKey {
    fn prepare(&self) -> sapling::note_encryption::PreparedIncomingViewingKey {
        self.0.prepare()
    }
    fn account_id(&self) -> &u32 {
        &0
    }
    fn key_scope(&self) -> Option<zip32::Scope> {
        Some(zip32::Scope::External)
    }
    fn nf(&self, _: &sapling::Note, _: Position) -> Option<sapling::Nullifier> {
        None
    }
}
pub fn scanning_keys(key: &UnifiedIncomingViewingKey) -> ScanningKeys<u32, u32> {
    let mut s = HashMap::new();
    let mut o = HashMap::new();
    let mut i = HashMap::new();
    if let Some(k) = key.sapling() {
        s.insert(
            0,
            Box::new(SaplingKey(k.clone()))
                as Box<dyn ScanningKeyOps<SaplingDomain, u32, sapling::Nullifier> + Send + Sync>,
        );
    }
    if let Some(k) = key.orchard() {
        o.insert(
            0,
            Box::new(ScanningKey::new(
                k.clone(),
                None::<orchard::keys::FullViewingKey>,
                0u32,
                Some(zip32::Scope::External),
            ))
                as Box<
                    dyn ScanningKeyOps<
                            orchard::note_encryption::OrchardDomain,
                            u32,
                            orchard::note::Nullifier,
                        > + Send
                        + Sync,
                >,
        );
        i.insert(
            0,
            Box::new(ScanningKey::new(
                k.clone(),
                None::<orchard::keys::FullViewingKey>,
                0u32,
                Some(zip32::Scope::External),
            ))
                as Box<
                    dyn ScanningKeyOps<
                            orchard::note_encryption::IronwoodDomain,
                            u32,
                            orchard::note::Nullifier,
                        > + Send
                        + Sync,
                >,
        );
    }
    ScanningKeys::new(s, o, i)
}
fn orchard_outputs<V: DomainVersion>(
    keys: &HashMap<u32, UnifiedIncomingViewingKey>,
    bundle: &orchard::bundle::Bundle<
        orchard::bundle::Authorized,
        zcash_protocol::value::ZatBalance,
    >,
    pool: orchard::ValuePool,
    shielded: ShieldedPool,
) -> Vec<DecryptedOutput<(orchard::Note, orchard::ValuePool), u32>> {
    let mut outputs = vec![];
    for (account, key) in keys {
        if let Some(key) = key.orchard() {
            let prepared = orchard::keys::PreparedIncomingViewingKey::new(key);
            for (index, action) in bundle.actions().iter().enumerate() {
                if let Some((note, _, memo)) = try_note_decryption(
                    &NoteEncryptionDomain::<V>::for_action(action),
                    &prepared,
                    action,
                ) {
                    outputs.push(DecryptedOutput::new(
                        index,
                        (note, pool),
                        shielded,
                        *account,
                        MemoBytes::from_bytes(&memo).expect("fixed-size memo"),
                        TransferType::Incoming,
                    ));
                }
            }
        }
    }
    outputs
}
pub fn decrypt<'a>(
    network: &Network,
    height: BlockHeight,
    tx: &'a Transaction,
    keys: &HashMap<u32, UnifiedIncomingViewingKey>,
) -> DecryptedTransaction<'a, Transaction, u32> {
    let mut sapling = vec![];
    if let Some(bundle) = tx.sapling_bundle() {
        let domain = SaplingDomain::new(zip212_enforcement(network, height));
        for (account, key) in keys {
            if let Some(key) = key.sapling() {
                for (index, output) in bundle.shielded_outputs().iter().enumerate() {
                    if let Some((note, _, memo)) =
                        try_note_decryption(&domain, &key.prepare(), output)
                    {
                        sapling.push(DecryptedOutput::new(
                            index,
                            note,
                            ShieldedPool::Sapling,
                            *account,
                            MemoBytes::from_bytes(&memo).expect("fixed-size memo"),
                            TransferType::Incoming,
                        ));
                    }
                }
            }
        }
    }
    let orchard = tx
        .orchard_bundle()
        .map(|b| {
            orchard_outputs::<OrchardVersion>(
                keys,
                b,
                orchard::ValuePool::Orchard,
                ShieldedPool::Orchard,
            )
        })
        .unwrap_or_default();
    let ironwood = tx
        .ironwood_bundle()
        .map(|b| {
            orchard_outputs::<IronwoodVersion>(
                keys,
                b,
                orchard::ValuePool::Ironwood,
                ShieldedPool::Ironwood,
            )
        })
        .unwrap_or_default();
    DecryptedTransaction::new(Some(height), tx, sapling, orchard, ironwood)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn key_encoding_binds_network_and_rotated_receivers() {
        let n = Network::TestNetwork;
        let full = zcash_keys::keys::UnifiedSpendingKey::from_seed(&n, &[7;32], zip32::AccountId::ZERO).unwrap().to_unified_full_viewing_key();
        let incoming = full.to_unified_incoming_viewing_key();
        let encoded = incoming.encode(&n);
        assert!(encoded.starts_with("uivktest1"));
        assert!(decode(&Network::MainNetwork, &encoded).is_err());
        let decoded = decode(&n, &encoded).unwrap();
        let rotated = full.orchard().unwrap().address_at(19u32,zip32::Scope::External);
        assert!(decoded.orchard().as_ref().unwrap().diversifier_index(&rotated).is_some());
        assert_eq!(decode(&n, &full.encode(&n)).unwrap().encode(&n),encoded);
        let scanning = scanning_keys(&decoded);
        assert_eq!(scanning.sapling().len(),1);
        assert_eq!(scanning.orchard().len(),1);
        assert_eq!(scanning.ironwood().len(),1);
    }
}
