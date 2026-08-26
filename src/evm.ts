export interface Eip1193RequestArguments {
  readonly method: string;
  readonly params?: object | readonly unknown[];
}

export interface Eip1193ProviderRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
}

export type Eip1193Listener = (...arguments_: unknown[]) => void;

export interface Eip1193Provider {
  on(eventName: string, listener: Eip1193Listener): this;
  removeListener(eventName: string, listener: Eip1193Listener): this;
  request(arguments_: Eip1193RequestArguments): Promise<unknown>;
}

export interface Eip6963ProviderInfo {
  readonly icon: string;
  readonly name: string;
  readonly rdns: string;
  readonly uuid: string;
}

export interface Eip6963ProviderDetail {
  readonly info: Eip6963ProviderInfo;
  readonly provider: Eip1193Provider;
}

export const EIP6963_ANNOUNCE_PROVIDER_EVENT = "eip6963:announceProvider" as const;
export const EIP6963_REQUEST_PROVIDER_EVENT = "eip6963:requestProvider" as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_DATA_URI = /^data:image\/(?:gif|png|svg\+xml|webp)(?:;[^,]*)?,/i;
const REVERSE_DNS = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function isEip6963ProviderDetail(value: unknown): value is Eip6963ProviderDetail {
  if (!isRecord(value) || !isRecord(value.info) || !isRecord(value.provider)) return false;
  return (
    typeof value.info.uuid === "string" && UUID_V4.test(value.info.uuid) &&
    typeof value.info.name === "string" && value.info.name.length > 0 &&
    typeof value.info.icon === "string" && IMAGE_DATA_URI.test(value.info.icon) &&
    typeof value.info.rdns === "string" && REVERSE_DNS.test(value.info.rdns) &&
    typeof value.provider.request === "function" &&
    typeof value.provider.on === "function" &&
    typeof value.provider.removeListener === "function"
  );
}

/**
 * Subscribes to EIP-6963 announcements and requests all installed providers to re-announce.
 * The returned function removes the listener.
 */
export function requestEip6963Providers(
  onProvider: (detail: Eip6963ProviderDetail) => void,
  target: EventTarget = window,
): () => void {
  const listener: EventListener = (event) => {
    if (event instanceof CustomEvent && isEip6963ProviderDetail(event.detail)) {
      onProvider(event.detail);
    }
  };
  target.addEventListener(EIP6963_ANNOUNCE_PROVIDER_EVENT, listener);
  target.dispatchEvent(new Event(EIP6963_REQUEST_PROVIDER_EVENT));
  return () => target.removeEventListener(EIP6963_ANNOUNCE_PROVIDER_EVENT, listener);
}
