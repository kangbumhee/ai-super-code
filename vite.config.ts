import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { crx } from '@crxjs/vite-plugin';
import { resolve } from 'path';

// manifest를 직접 객체로 정의 (JSON import 방식이 CRXJS 빌드 시 manifest 미생성 원인이 될 수 있음)
const manifest = {
  manifest_version: 3,
  name: 'OmniCoder v2.0 — AI 자동 코딩 시스템',
  version: '2.0.0',
  description: 'Claude 채팅 두뇌(무료) + 저렴한 API 실행 = 완전 자동 코딩',
  permissions: [
    'storage',
    'activeTab',
    'tabs',
    'cookies',
    'notifications',
    'clipboardRead',
    'clipboardWrite',
    'downloads',
    'alarms',
    'scripting',
    'offscreen',
  ],
  host_permissions: [
    'https://www.genspark.ai/*',
    'https://api.anthropic.com/*',
    'http://127.0.0.1:7842/*',
  ],
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module' as const,
  },
  action: {
    default_icon: {
      '16': 'src/assets/icon16.png',
      '48': 'src/assets/icon48.png',
      '128': 'src/assets/icon128.png',
    },
  },
  icons: {
    '16': 'src/assets/icon16.png',
    '48': 'src/assets/icon48.png',
    '128': 'src/assets/icon128.png',
  },
  content_scripts: [
    {
      matches: ['https://www.genspark.ai/*'],
      js: ['src/content/genspark-monitor.ts'],
      run_at: 'document_idle' as const,
    },
  ],
};

export default defineConfig({
  plugins: [react(), crx({ manifest })],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      input: {
        dashboard: resolve(__dirname, 'src/dashboard/index.html'),
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
