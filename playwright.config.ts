import {defineConfig,devices} from '@playwright/test';
const port=Number(process.env.E2E_PORT || 9002);
const base=`http://127.0.0.1:${port}`;
process.env.APP_BASE_URL=base;
export default defineConfig({
 testDir:'./tests/e2e/specs',workers:1,fullyParallel:false,forbidOnly:!!process.env.CI,
 retries:0,reporter:'list',timeout:90000,expect:{timeout:15000},
 globalSetup:'./tests/e2e/setup.ts',
 use:{baseURL:base,actionTimeout:20000,navigationTimeout:45000,trace:'retain-on-failure',screenshot:'only-on-failure',locale:'tr-TR',timezoneId:'Europe/Istanbul'},
 projects:[{name:'chromium',use:{...devices['Desktop Chrome'],...(process.env.PLAYWRIGHT_CHROMIUM_PATH?{launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_PATH}}:{})}}],
 webServer:{command:`pnpm db:local && pnpm exec next dev -p ${port} --hostname 127.0.0.1`,url:base,reuseExistingServer:false,timeout:180000,
 env:{QORE_LOCAL_DATABASE:process.env.E2E_DATABASE_DIR || '/tmp/qore-e2e-db',NEXT_TELEMETRY_DISABLED:'1',APP_BASE_URL:base}}
});
