/**
 * Vitest 테스트 글로벌 셋업
 * chrome API 모킹
 */
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Chrome API 모킹
const mockStorage: Record<string, unknown> = {};

const chromeMock = {
  storage: {
    sync: {
      get: vi.fn((keys: string | string[], cb?: (result: Record<string, unknown>) => void) => {
        const result: Record<string, unknown> = {};
        const keyArr = typeof keys === 'string' ? [keys] : keys;
        for (const k of keyArr) {
          if (mockStorage[k] !== undefined) result[k] = mockStorage[k];
        }
        if (cb) cb(result);
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
        Object.assign(mockStorage, items);
        if (cb) cb();
        return Promise.resolve();
      })
    },
    local: {
      get: vi.fn((keys: string | string[], cb?: (result: Record<string, unknown>) => void) => {
        const result: Record<string, unknown> = {};
        const keyArr = typeof keys === 'string' ? [keys] : keys;
        for (const k of keyArr) {
          if (mockStorage[k] !== undefined) result[k] = mockStorage[k];
        }
        if (cb) cb(result);
        return Promise.resolve(result);
      }),
      set: vi.fn((items: Record<string, unknown>, cb?: () => void) => {
        Object.assign(mockStorage, items);
        if (cb) cb();
        return Promise.resolve();
      })
    }
  },
  runtime: {
    sendMessage: vi.fn(),
    onMessage: {
      addListener: vi.fn()
    }
  },
  alarms: {
    create: vi.fn(),
    onAlarm: {
      addListener: vi.fn()
    }
  },
  notifications: {
    create: vi.fn()
  },
  tabs: {
    query: vi.fn()
  },
  cookies: {
    set: vi.fn()
  },
  downloads: {
    download: vi.fn()
  },
  scripting: {
    executeScript: vi.fn()
  }
};

// @ts-expect-error — 테스트용 글로벌 모킹
globalThis.chrome = chromeMock;
