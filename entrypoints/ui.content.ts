import {
  displayModeItem,
  newAccountEnabledItem,
  newAccountDaysItem,
  followsYouEnabledItem,
  type DisplayMode,
} from '@/utils/settings';

interface UserInfo {
  followers?: number;
  createdAt?: number; // ms epoch
  followsYou?: boolean;
}

// Runs in the isolated world (default). Receives user data from the MAIN-world
// interceptor via window.postMessage, reads the user's preferences from
// storage, and injects badges into the timeline.
export default defineContentScript({
  matches: ['*://x.com/*', '*://twitter.com/*'],
  runAt: 'document_start',
  async main() {
    // screen_name (lowercased) -> info
    const users = new Map<string, UserInfo>();

    let displayMode: DisplayMode = await displayModeItem.getValue();
    let newAccountEnabled = await newAccountEnabledItem.getValue();
    let newAccountDays = await newAccountDaysItem.getValue();
    let followsYouEnabled = await followsYouEnabledItem.getValue();

    // ---- receive data from the MAIN-world interceptor -------------------
    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__xrayFollowers !== true) return;
      if (typeof data.screenName !== 'string') return;

      const key = data.screenName.toLowerCase();
      const prev = users.get(key) ?? {};
      const next: UserInfo = { ...prev };
      let changed = false;

      if (typeof data.followers === 'number' && prev.followers !== data.followers) {
        next.followers = data.followers;
        changed = true;
      }
      if (typeof data.createdAt === 'number' && prev.createdAt !== data.createdAt) {
        next.createdAt = data.createdAt;
        changed = true;
      }
      if (typeof data.followsYou === 'boolean' && prev.followsYou !== data.followsYou) {
        next.followsYou = data.followsYou;
        changed = true;
      }

      if (changed) {
        users.set(key, next);
        scheduleInject();
      }
    });

    // ---- react to settings changing ------------------------------------
    displayModeItem.watch((v) => {
      displayMode = v;
      scheduleInject();
    });
    newAccountEnabledItem.watch((v) => {
      newAccountEnabled = v;
      scheduleInject();
    });
    newAccountDaysItem.watch((v) => {
      newAccountDays = v;
      scheduleInject();
    });
    followsYouEnabledItem.watch((v) => {
      followsYouEnabled = v;
      scheduleInject();
    });

    // ---------------------------------------------------------------------
    // Formatting helpers
    // ---------------------------------------------------------------------
    const FONT_FAMILY =
      'TwitterChirp, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

    const INFO_ICON =
      '<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" aria-hidden="true" style="flex:none"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>';

    function formatCount(n: number): string {
      if (n >= 1_000_000)
        return (
          (n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') +
          'M'
        );
      if (n >= 1_000)
        return (
          (n / 1_000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '') + 'K'
        );
      return String(n);
    }

    function followersLabel(count: number): string {
      const num = formatCount(count);
      return displayMode === 'compact' ? `· ${num}` : `· ${num} followers`;
    }

    function ageLabel(createdAt: number): string {
      const days = Math.max(0, Math.floor((Date.now() - createdAt) / 86_400_000));
      if (days < 31) return `${days}d`;
      const months = Math.floor(days / 30);
      if (months < 12) return `${months}mo`;
      return `${Math.floor(days / 365)}y`;
    }

    function joinedTitle(createdAt: number): string {
      const date = new Date(createdAt).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
      return `New account · joined ${date} (${ageLabel(createdAt)} ago)`;
    }

    // ---------------------------------------------------------------------
    // Handle extraction
    // ---------------------------------------------------------------------
    const HREF_RE = /^\/([A-Za-z0-9_]{1,15})$/;
    const AT_RE = /^@([A-Za-z0-9_]{1,15})$/;

    // Returns the screen name plus the element the badges should be appended
    // to. We prefer the "@handle" line so badges stay inline even on the
    // tweet-detail page (where User-Name is a vertical column).
    function findHandleParts(
      el: HTMLElement,
    ): { handle: string; host: HTMLElement } | null {
      const spans = el.querySelectorAll<HTMLElement>('span');
      for (const span of spans) {
        const m = (span.textContent || '').match(AT_RE);
        if (m) return { handle: m[1], host: span.parentElement ?? el };
      }
      const links = el.querySelectorAll<HTMLAnchorElement>('a[href^="/"]');
      for (const link of links) {
        const m = (link.getAttribute('href') || '').match(HREF_RE);
        if (m) return { handle: m[1], host: el };
      }
      return null;
    }

    // ---------------------------------------------------------------------
    // Badge rendering (idempotent — safe to call every frame)
    // ---------------------------------------------------------------------
    const resolved = new WeakMap<HTMLElement, { host: HTMLElement; handle: string }>();

    function renderHost(host: HTMLElement, info: UserInfo, fontSize: string) {
      // --- followers ---
      if (info.followers !== undefined) {
        let badge = host.querySelector<HTMLElement>('.xray-followers');
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'xray-followers';
          badge.style.cssText = [
            `font-family:${FONT_FAMILY}`,
            `font-size:${fontSize}`,
            'font-weight:400',
            'margin-left:4px',
            'color:inherit',
            'white-space:nowrap',
          ].join(';');
          host.appendChild(badge);
        }
        const label = followersLabel(info.followers);
        if (badge.textContent !== label) {
          badge.textContent = label;
          badge.title = `${info.followers.toLocaleString()} followers`;
        }
      }

      // --- new account ---
      const isNew =
        newAccountEnabled &&
        info.createdAt !== undefined &&
        Date.now() - info.createdAt < newAccountDays * 86_400_000;
      let newBadge = host.querySelector<HTMLElement>('.xray-newacct');
      if (isNew) {
        if (!newBadge) {
          newBadge = document.createElement('span');
          newBadge.className = 'xray-newacct';
          newBadge.style.cssText = [
            `font-family:${FONT_FAMILY}`,
            'display:inline-flex',
            'align-items:center',
            'align-self:center',
            'gap:2px',
            'margin-left:6px',
            'padding:0 6px',
            'height:1.25em',
            'border-radius:4px',
            'font-size:12px',
            'font-weight:600',
            'line-height:1',
            'color:rgb(29,155,240)',
            'background:rgba(29,155,240,0.1)',
            'white-space:nowrap',
            'vertical-align:middle',
          ].join(';');
          newBadge.innerHTML = INFO_ICON;
          newBadge.appendChild(document.createElement('span'));
          host.appendChild(newBadge);
        }
        const text = newBadge.lastElementChild as HTMLElement;
        const label = ageLabel(info.createdAt!);
        if (text.textContent !== label) text.textContent = label;
        newBadge.title = joinedTitle(info.createdAt!);
      } else if (newBadge) {
        newBadge.remove();
      }

      // --- follows you ---
      const showFollows = followsYouEnabled && info.followsYou === true;
      let followsBadge = host.querySelector<HTMLElement>('.xray-followsyou');
      if (showFollows) {
        if (!followsBadge) {
          followsBadge = document.createElement('span');
          followsBadge.className = 'xray-followsyou';
          followsBadge.textContent = 'Follows you';
          followsBadge.style.cssText = [
            `font-family:${FONT_FAMILY}`,
            'display:inline-flex',
            'align-items:center',
            'align-self:center',
            'margin-left:6px',
            'padding:0 6px',
            'height:1.45em',
            'border-radius:4px',
            'font-size:11px',
            'font-weight:500',
            'line-height:1',
            'color:inherit',
            'background:rgba(127,127,127,0.2)',
            'white-space:nowrap',
            'vertical-align:middle',
          ].join(';');
          host.appendChild(followsBadge);
        }
      } else if (followsBadge) {
        followsBadge.remove();
      }
    }

    // Tweet authors (regular + quoted tweets + detail view).
    function injectNames() {
      const nameEls = document.querySelectorAll<HTMLElement>(
        '[data-testid="User-Name"]',
      );
      for (const el of nameEls) {
        let entry = resolved.get(el);
        if (!entry) {
          const parts = findHandleParts(el);
          if (!parts) continue;
          entry = parts;
          resolved.set(el, entry);
        }
        const info = users.get(entry.handle.toLowerCase());
        if (info) renderHost(entry.host, info, '15px');
      }
    }

    // "X reposted" headers — show the reposter's stats.
    function injectReposts() {
      const ctxEls = document.querySelectorAll<HTMLElement>(
        '[data-testid="socialContext"]',
      );
      for (const el of ctxEls) {
        let entry = resolved.get(el);
        if (!entry) {
          const anchor = el.closest<HTMLAnchorElement>('a[href^="/"]');
          const m = anchor?.getAttribute('href')?.match(HREF_RE);
          if (!m) continue; // e.g. "You reposted" has no profile link
          entry = { handle: m[1], host: el };
          resolved.set(el, entry);
        }
        const info = users.get(entry.handle.toLowerCase());
        if (info) renderHost(entry.host, info, '13px');
      }
    }

    function injectBadges() {
      injectNames();
      injectReposts();
    }

    let scheduled = false;
    function scheduleInject() {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        injectBadges();
      });
    }

    function start() {
      injectBadges();
      const observer = new MutationObserver(() => scheduleInject());
      observer.observe(document.body, { childList: true, subtree: true });
    }

    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  },
});
