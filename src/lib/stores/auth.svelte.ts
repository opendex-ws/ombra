import { apiUrl } from '$lib/api/config';

export type SolanaWalletKind = 'phantom' | 'brave';

interface SolanaProvider {
  isPhantom?: boolean;
  isBraveWallet?: boolean;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  disconnect(): void;
  signMessage(message: Uint8Array, encoding?: string): Promise<{ signature: Uint8Array } | Uint8Array>;
}

interface WindowWithWallets extends Window {
  phantom?: { solana?: SolanaProvider };
  braveSolana?: SolanaProvider;
  solana?: SolanaProvider;
}

interface AuthChallenge {
  challengeId?: string;
  message: string;
  domain: string;
  chainId: string;
}

let token = $state<string | null>(typeof window !== 'undefined' ? localStorage.getItem('ombra_token') : null);
let walletAddress = $state<string | null>(typeof window !== 'undefined' ? localStorage.getItem('ombra_wallet') : null);
let connecting = $state(false);
let error = $state<string | null>(null);

let isLoggedIn = $derived(token !== null);

const REFRESH_LEAD_MS = 60_000;
const MIN_REFRESH_DELAY_MS = 1_000;
const REFRESH_RETRY_MS = 15_000;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshInFlight: Promise<string | null> | null = null;
const tokenListeners = new Set<(token: string | null) => void>();

/**
 * Subscribe to auth-token changes (sign-in, refresh, disconnect). Used by the WS
 * layer to re-authenticate the live socket when the JWT is refreshed without a
 * full reconnect. Returns an unsubscribe function.
 */
export function onAuthTokenChange(listener: (token: string | null) => void): () => void {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

function notifyTokenListeners(next: string | null): void {
  for (const listener of tokenListeners) {
    try {
      listener(next);
    } catch {
      /* ignore listener errors */
    }
  }
}

function parseJwtExp(jwt: string): number | null {
  const parts = jwt.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(payload)) as { exp?: number };
    return typeof json.exp === 'number' ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

function clearRefreshTimer(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleRefresh(): void {
  clearRefreshTimer();
  if (typeof window === 'undefined' || !token) return;
  const expMs = parseJwtExp(token);
  if (expMs === null) return;
  const delay = Math.max(expMs - Date.now() - REFRESH_LEAD_MS, MIN_REFRESH_DELAY_MS);
  refreshTimer = setTimeout(() => { void refreshToken(); }, delay);
}

function scheduleRetry(): void {
  clearRefreshTimer();
  if (typeof window === 'undefined' || !token) return;
  refreshTimer = setTimeout(() => { void refreshToken(); }, REFRESH_RETRY_MS);
}

/**
 * Refresh the current JWT via POST /v2/auth/refresh. Concurrent callers share a
 * single in-flight request. On success the new token is stored (which reschedules
 * the next refresh); on failure the session is disconnected. Returns the new token
 * or null.
 */
export function refreshToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight;
  const current = token;
  if (typeof window === 'undefined' || !current) return Promise.resolve(null);
  refreshInFlight = (async () => {
    try {
      const resp = await fetch(apiUrl('/v2/auth/refresh'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${current}` }
      });
      if (!resp.ok) {
        disconnect();
        return null;
      }
      const { token: next } = await resp.json() as { token: string };
      if (!next) {
        disconnect();
        return null;
      }
      setAuthToken(next);
      return next;
    } catch {
      // Transient network error: keep the session and retry near-term instead of
      // logging the user out or waiting for the token to expire.
      scheduleRetry();
      return current;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

/** Schedule a refresh for an existing token on app start. Call once on layout mount. */
export function initAuth(): void {
  scheduleRefresh();
}

export function getAuthToken(): string | null {
  return token;
}

export function getIsLoggedIn(): boolean {
  return isLoggedIn;
}

export function getWalletAddress(): string | null {
  return walletAddress;
}

export function getIsConnecting(): boolean {
  return connecting;
}

export function getAuthError(): string | null {
  return error;
}

export function setAuthToken(t: string | null): void {
  const changed = token !== t;
  token = t;
  if (typeof window !== 'undefined') {
    if (t) localStorage.setItem('ombra_token', t);
    else localStorage.removeItem('ombra_token');
  }
  if (t) scheduleRefresh();
  else clearRefreshTimer();
  if (changed) notifyTokenListeners(t);
}

export function completeGoogleLogin(jwt: string, wallet: string | null): void {
  setAuthToken(jwt);
  setWallet(wallet);
}

function setWallet(addr: string | null): void {
  walletAddress = addr;
  if (typeof window !== 'undefined') {
    if (addr) localStorage.setItem('ombra_wallet', addr);
    else localStorage.removeItem('ombra_wallet');
  }
}

let activeWallet: SolanaWalletKind = 'phantom';

export function getSolanaWallet(kind: SolanaWalletKind): SolanaProvider | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as WindowWithWallets;
  if (kind === 'phantom') {
    const provider = w.phantom?.solana;
    return provider?.isPhantom ? provider : null;
  }
  if (w.braveSolana) return w.braveSolana;
  if (w.solana?.isBraveWallet) return w.solana;
  return null;
}

export function isSolanaWalletInstalled(kind: SolanaWalletKind): boolean {
  return getSolanaWallet(kind) !== null;
}

export function isPhantomInstalled(): boolean {
  return isSolanaWalletInstalled('phantom');
}

function activeProvider(): SolanaProvider | null {
  return getSolanaWallet(activeWallet) ?? getSolanaWallet('phantom') ?? getSolanaWallet('brave');
}

function errorText(e: unknown, fallback: string): string {
  if (e instanceof Error && e.message) return e.message;
  if (e && typeof e === 'object' && 'message' in e && typeof e.message === 'string' && e.message) {
    return e.message;
  }
  return fallback;
}

async function signSolanaMessage(provider: SolanaProvider, message: string): Promise<Uint8Array> {
  const encoded = new TextEncoder().encode(message);
  // The second "utf8" argument makes current Phantom throw "Unexpected error".
  const signed = await provider.signMessage(encoded);
  const signature = signed instanceof Uint8Array ? signed : signed.signature;
  if (!signature) throw new Error('Wallet did not return a signature');
  return signature;
}

export async function signConnectedWalletMessageHex(message: string): Promise<string> {
  const provider = activeProvider();
  if (!provider) throw new Error('No Solana wallet is available');
  const connected = await provider.connect();
  if (walletAddress && connected.publicKey.toString() !== walletAddress) {
    throw new Error('Connect the Solana wallet used to sign in');
  }
  const signature = await signSolanaMessage(provider, message);
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function connectWallet(kind: SolanaWalletKind = 'phantom'): Promise<void> {
  const provider = getSolanaWallet(kind);
  if (!provider) {
    window.open(kind === 'brave' ? 'https://brave.com/wallet/' : 'https://phantom.app/download', '_blank');
    return;
  }
  activeWallet = kind;

  connecting = true;
  error = null;

  try {
    const resp = await provider.connect();
    const pubkey = resp.publicKey.toString();

    const msgResp = await fetch(apiUrl('/v2/auth/challenge'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'web3',
        web3: {
          chain: 'SOL',
          address: pubkey,
          signatureProtocol: 'solana_legacy'
        }
      })
    });
    if (!msgResp.ok) throw new Error('Failed to get sign-in message');
    const challenge = await msgResp.json() as AuthChallenge;

    const signatureBytes = await signSolanaMessage(provider, challenge.message);
    const bs58 = (await import('bs58')).default;
    const signatureB58 = bs58.encode(signatureBytes);

    const loginResp = await fetch(apiUrl('/v2/auth/signin'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        method: 'web3',
        web3: {
          chain: 'SOL',
          address: pubkey,
          signatureProtocol: 'solana_legacy',
          challengeId: challenge.challengeId ?? '',
          message: challenge.message,
          signature: signatureB58,
          domain: challenge.domain,
          chainId: challenge.chainId
        }
      })
    });

    if (!loginResp.ok) {
      const body = await loginResp.json().catch(() => ({})) as { message?: string };
      throw new Error(body.message ?? 'Login failed');
    }

    const { token: jwt } = await loginResp.json() as { token: string };
    setAuthToken(jwt);
    setWallet(pubkey);
  } catch (e: unknown) {
    error = errorText(e, 'Connection failed');
    throw e instanceof Error ? e : new Error(error);
  } finally {
    connecting = false;
  }
}

export function disconnect(): void {
  const provider = activeProvider();
  if (provider) {
    try { provider.disconnect(); } catch {}
  }
  setAuthToken(null);
  setWallet(null);
  error = null;
}
