# XRay

A small Chrome extension that shows follower counts (and a few other signals) next to profiles in your X/Twitter timeline.

It works by reading the data X already loads on the page — no API keys, no extra requests.

## Features

- Follower count next to every profile (timeline, quotes, reposts, detail view)
- "New account" badge for accounts younger than a threshold you pick
- "Follows you" badge
- Compact (`1.2K`) or full (`1.2K followers`) display
- Light/dark theme aware

Toggle everything from the popup.

## Develop

```bash
pnpm install
pnpm dev
```

## Build

```bash
pnpm build   # output in .output/chrome-mv3
```

Then load `.output/chrome-mv3` via `chrome://extensions` → Load unpacked.

Built with [WXT](https://wxt.dev).
