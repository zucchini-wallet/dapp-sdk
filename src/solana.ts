import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
  SolanaSignIn,
  type SolanaSignInFeature,
  SolanaSignMessage,
  type SolanaSignMessageFeature,
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletWithFeatures } from "@wallet-standard/base";
import {
  StandardConnect,
  type StandardConnectFeature,
  StandardEvents,
  type StandardEventsFeature,
} from "@wallet-standard/features";

export {
  SolanaSignAndSendTransaction,
  SolanaSignIn,
  SolanaSignMessage,
  SolanaSignTransaction,
  StandardConnect,
  StandardEvents,
};
export type {
  SolanaSignAndSendTransactionFeature,
  SolanaSignInFeature,
  SolanaSignMessageFeature,
  SolanaSignTransactionFeature,
  StandardConnectFeature,
  StandardEventsFeature,
  Wallet,
};

export type ZucchiniCompatibleSolanaWallet = WalletWithFeatures<
  StandardConnectFeature &
    StandardEventsFeature &
    SolanaSignInFeature &
    SolanaSignMessageFeature &
    SolanaSignTransactionFeature &
    SolanaSignAndSendTransactionFeature
>;

const REQUIRED_SOLANA_FEATURES = [
  [StandardConnect, "connect"],
  [StandardEvents, "on"],
  [SolanaSignIn, "signIn"],
  [SolanaSignMessage, "signMessage"],
  [SolanaSignTransaction, "signTransaction"],
  [SolanaSignAndSendTransaction, "signAndSendTransaction"],
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isZucchiniCompatibleSolanaWallet(
  wallet: Wallet,
): wallet is ZucchiniCompatibleSolanaWallet {
  return REQUIRED_SOLANA_FEATURES.every(([feature, method]) => {
    const implementation = wallet.features[feature];
    return (
      isRecord(implementation) &&
      typeof implementation.version === "string" &&
      typeof implementation[method] === "function"
    );
  });
}

/** Returns all currently registered Wallet Standard wallets with Zucchini's required features. */
export function getCompatibleSolanaWallets(): readonly ZucchiniCompatibleSolanaWallet[] {
  return getWallets().get().filter(isZucchiniCompatibleSolanaWallet);
}

/** Subscribes to compatible Wallet Standard registrations. */
export function onCompatibleSolanaWalletRegistered(
  listener: (wallets: readonly ZucchiniCompatibleSolanaWallet[]) => void,
): () => void {
  return getWallets().on("register", (...wallets) => {
    const compatible = wallets.filter(isZucchiniCompatibleSolanaWallet);
    if (compatible.length > 0) listener(compatible);
  });
}
