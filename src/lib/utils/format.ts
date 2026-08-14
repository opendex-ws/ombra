import { apiUrl } from '$lib/api/config';

export function formatUsd(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '$0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0';

  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';

  if (abs >= 1_000_000_000) return `${sign}$${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

const SUBSCRIPT_DIGITS = ['₀','₁','₂','₃','₄','₅','₆','₇','₈','₉'];
function toSubscript(n: number): string {
  return String(n).split('').map(d => SUBSCRIPT_DIGITS[parseInt(d)]).join('');
}

export function formatPriceText(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '$0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0';

  if (num >= 1) return `$${num.toFixed(2)}`;
  if (num >= 0.01) return `$${num.toFixed(4)}`;
  if (num >= 0.0001) return `$${num.toFixed(6)}`;
  const s = num.toFixed(20);
  const match = s.match(/^0\.0*(0+)/);
  if (match) {
    const zeroCount = match[0].length - 2;
    if (zeroCount > 3) {
      const sigStart = 2 + zeroCount;
      const sig = s.slice(sigStart, sigStart + 4).replace(/0+$/, '');
      return `$0.0${toSubscript(zeroCount)}${sig || '0'}`;
    }
  }
  return `$${num.toFixed(10).replace(/0+$/, '')}`;
}

export function formatPrice(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '$0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '$0';

  if (num >= 1) return `$${num.toFixed(2)}`;
  if (num >= 0.01) return `$${num.toFixed(4)}`;
  if (num >= 0.0001) return `$${num.toFixed(6)}`;
  const s = num.toFixed(20);
  const match = s.match(/^0\.0*(0+)/);
  if (match) {
    const zeroCount = match[0].length - 2;
    if (zeroCount > 3) {
      const sigStart = 2 + zeroCount;
      const sig = s.slice(sigStart, sigStart + 4).replace(/0+$/, '');
      return `$0.0<sub>${zeroCount}</sub>${sig || '0'}`;
    }
  }
  return `$${num.toFixed(10).replace(/0+$/, '')}`;
}

export function formatPercent(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '0%';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0%';

  const sign = num > 0 ? '+' : '';
  const abs = Math.abs(num);
  if (abs >= 1_000_000) return `${sign}${(num / 1_000_000).toFixed(1)}M%`;
  if (abs >= 1_000) return `${sign}${(num / 1_000).toFixed(1)}K%`;
  return `${sign}${num.toFixed(2)}%`;
}

export function formatNumber(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';

  return num.toLocaleString('en-US');
}

export function formatCompactNumber(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`;
  if (abs >= 1) return `${sign}${abs.toFixed(2)}`;
  return `${sign}${abs.toFixed(4)}`;
}

export function shortAddress(address: string): string {
  if (!address || address.length < 10) return address ?? '';
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function formatMarketCap(value: string | number | undefined | null): string {
  return formatUsd(value);
}

export function formatMultiplier(value: string | number): string {
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '1.00x';
  return `${num.toFixed(2)}x`;
}

export function truncate(str: string, maxLen: number = 16): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…';
}

export function timeAgo(timestamp: number | string, now?: number): string {
  let ms: number;
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    if (!isNaN(parsed)) {
      ms = parsed;
    } else {
      const ts = parseInt(timestamp, 10);
      if (isNaN(ts)) return '';
      ms = ts < 1e12 ? ts * 1000 : ts;
    }
  } else {
    ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  }

  const current = now ?? Date.now();
  const diff = Math.max(0, current - ms);
  const seconds = Math.floor(diff / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function fullDateTime(timestamp: number | string): string {
  let ms: number;
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    if (!isNaN(parsed)) {
      ms = parsed;
    } else {
      const ts = parseInt(timestamp, 10);
      if (isNaN(ts)) return '';
      ms = ts < 1e12 ? ts * 1000 : ts;
    }
  } else {
    if (!timestamp) return '';
    ms = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  }
  return new Date(ms).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit',
  });
}

export function ageFromSeconds(seconds: number | undefined): string {
  if (seconds === undefined || seconds === null) return '';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function liveAge(createdAt: string | number | undefined | null, now: number): string {
  if (createdAt == null || createdAt === '') return '';
  const ms = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt);
  if (isNaN(ms)) return '';
  const seconds = Math.max(0, Math.floor((now - ms) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export function explorerTxUrl(chain: string, txHash: string): string {
  switch (chain) {
    case 'SOL': return `https://solscan.io/tx/${txHash}`;
    case 'ETH': return `https://etherscan.io/tx/${txHash}`;
    case 'BASE': return `https://basescan.org/tx/${txHash}`;
    case 'BSC': return `https://bscscan.com/tx/${txHash}`;
    default: return '#';
  }
}

import { isUsd } from '$lib/stores/currency.svelte';

const CHAIN_SYMBOL: Record<string, string> = { SOL: 'SOL', ETH: 'ETH', BASE: 'ETH', BSC: 'BNB' };

function nativeSym(chain?: string): string {
  return CHAIN_SYMBOL[chain ?? 'SOL'] ?? 'SOL';
}

function formatNativeNum(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`;
  if (abs >= 1) return `${sign}${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}${abs.toFixed(4)}`;
  const s = abs.toFixed(20);
  const match = s.match(/^0\.0*(0+)/);
  if (match) {
    const zeroCount = match[0].length - 2;
    if (zeroCount > 3) {
      const sigStart = 2 + zeroCount;
      const sig = s.slice(sigStart, sigStart + 4).replace(/0+$/, '');
      return `${sign}0.0${toSubscript(zeroCount)}${sig || '0'}`;
    }
  }
  return `${sign}${abs.toPrecision(3)}`;
}

function formatNativeNumHtml(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '0';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return '0';
  const abs = Math.abs(num);
  const sign = num < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${(abs / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}${(abs / 1_000).toFixed(2)}K`;
  if (abs >= 1) return `${sign}${abs.toFixed(2)}`;
  if (abs >= 0.01) return `${sign}${abs.toFixed(4)}`;
  const s = abs.toFixed(20);
  const match = s.match(/^0\.0*(0+)/);
  if (match) {
    const zeroCount = match[0].length - 2;
    if (zeroCount > 3) {
      const sigStart = 2 + zeroCount;
      const sig = s.slice(sigStart, sigStart + 4).replace(/0+$/, '');
      return `${sign}0.0<sub>${zeroCount}</sub>${sig || '0'}`;
    }
  }
  return `${sign}${abs.toPrecision(3)}`;
}

export function fmtVal(usdVal: string | number | undefined | null, nativeVal: string | number | undefined | null, chain?: string): string {
  if (isUsd()) return formatUsd(usdVal);
  return `${formatNativeNum(nativeVal)} ${nativeSym(chain)}`;
}

export function fmtValNum(usdVal: string | number | undefined | null, nativeVal: string | number | undefined | null): string {
  return isUsd() ? formatUsd(usdVal) : formatNativeNum(nativeVal);
}

export function fmtPriceNum(usdStr: string | number | undefined | null, nativeStr: string | number | undefined | null): string {
  return isUsd() ? formatPriceText(usdStr) : formatNativeNum(nativeStr);
}

export function fmtPriceNumHtml(usdStr: string | number | undefined | null, nativeStr: string | number | undefined | null): string {
  return isUsd() ? formatPrice(usdStr) : formatNativeNumHtml(nativeStr);
}

export function fmtPrice(usdStr: string | number | undefined | null, nativeStr: string | number | undefined | null, chain?: string): string {
  if (isUsd()) return formatPriceText(usdStr);
  return `${formatNativeNum(nativeStr)} ${nativeSym(chain)}`;
}

export function fmtPriceHtml(usdStr: string | number | undefined | null, nativeStr: string | number | undefined | null, chain?: string): string {
  if (isUsd()) return formatPrice(usdStr);
  return `${formatNativeNumHtml(nativeStr)} ${nativeSym(chain)}`;
}

export function formatPeg(value: string | number | undefined | null, chain?: string): string {
  const num = typeof value === 'string' ? parseFloat(value ?? '0') : (value ?? 0);
  if (isNaN(num)) return `0 ${nativeSym(chain)}`;
  return `${formatNativeNum(num)} ${nativeSym(chain)}`;
}

export function explorerAddressUrl(chain: string, address: string): string {
  switch (chain) {
    case 'SOL': return `https://solscan.io/account/${address}`;
    case 'ETH': return `https://etherscan.io/address/${address}`;
    case 'BASE': return `https://basescan.org/address/${address}`;
    case 'BSC': return `https://bscscan.com/address/${address}`;
    default: return '#';
  }
}

export function pctColor(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return 'text-g6';
  const num = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(num)) return 'text-g6';
  return num > 0 ? 'text-grn' : num < 0 ? 'text-red' : 'text-g6';
}

export function pctBg(v: number | undefined | null): string {
  if (v == null) return 'bg-g6/20';
  return v > 0 ? 'bg-grn/20' : v < 0 ? 'bg-red/20' : 'bg-g6/20';
}

export function typeBadge(type: string): string {
  switch (type) {
    case 'CALLER': return 'bg-wh/20 text-tx';
    case 'TG': return 'bg-blu/20 text-blu';
    case 'LIST': return 'bg-yel/20 text-yel';
    case 'WALLET': return 'bg-grn/20 text-grn';
    default: return 'bg-g7/20 text-g7';
  }
}

export function sourceBadge(type: string): string {
  switch (type) {
    case 'CALLER': return 'bg-wh/10 text-tx';
    case 'TG': return 'bg-blu/20 text-blu';
    case 'LIST': return 'bg-yel/20 text-yel';
    case 'WALLET': return 'bg-grn/20 text-grn';
    default: return 'bg-g7/20 text-g7';
  }
}

export function parseTier(t: string): number {
  const n = parseFloat(t);
  return isNaN(n) ? -1 : n;
}

export function avatarUrl(photoId: string | undefined | null): string | null {
  if (!photoId) return null;
  return apiUrl(`/v2/avatar/${photoId}`);
}
