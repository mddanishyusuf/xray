import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react', '@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'assets/icon.svg',
  },
  manifest: {
    name: 'XRay — Twitter Follower Counts',
    description: 'Show follower counts next to profiles in your X/Twitter timeline.',
    permissions: ['storage'],
    host_permissions: ['*://x.com/*', '*://twitter.com/*'],
  },
});
