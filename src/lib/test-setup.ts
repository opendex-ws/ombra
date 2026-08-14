import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// SvelteKit's `$env/dynamic/public` isn't populated under vitest; stub it so
// modules that read PUBLIC_* env vars (e.g. the API client / config) import cleanly.
vi.mock('$env/dynamic/public', () => ({ env: {} }));
