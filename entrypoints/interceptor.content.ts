// Runs in the MAIN world so it can patch the page's own fetch/XHR and read
// the GraphQL responses (which already include follower counts). It does NOT
// touch the DOM or storage — it just forwards harvested counts to the
// isolated-world UI script via window.postMessage.
export default defineContentScript({
  matches: ['*://x.com/*', '*://twitter.com/*'],
  world: 'MAIN',
  runAt: 'document_start',
  main() {
    function post(payload: {
      screenName: string;
      followers?: number;
      createdAt?: number;
      followsYou?: boolean;
    }) {
      window.postMessage(
        { __xrayFollowers: true, ...payload },
        window.location.origin,
      );
    }

    // Recursively walk a parsed JSON payload looking for user objects.
    function harvest(node: any, depth = 0) {
      if (!node || typeof node !== 'object' || depth > 25) return;

      if (Array.isArray(node)) {
        for (const item of node) harvest(item, depth + 1);
        return;
      }

      const screenName =
        node?.core?.screen_name ??
        node?.legacy?.screen_name ??
        node?.screen_name;

      if (typeof screenName === 'string') {
        const followers =
          node?.legacy?.followers_count ??
          node?.relationship_counts?.followers ??
          node?.followers_count;

        const createdRaw = node?.core?.created_at ?? node?.legacy?.created_at;
        const createdMs =
          typeof createdRaw === 'string'
            ? new Date(createdRaw).getTime()
            : undefined;

        const followsYou =
          node?.relationship_perspectives?.followed_by ??
          node?.legacy?.followed_by;

        // Only emit if we actually learned something useful.
        if (
          typeof followers === 'number' ||
          (createdMs !== undefined && !Number.isNaN(createdMs)) ||
          typeof followsYou === 'boolean'
        ) {
          post({
            screenName,
            followers: typeof followers === 'number' ? followers : undefined,
            createdAt:
              createdMs !== undefined && !Number.isNaN(createdMs)
                ? createdMs
                : undefined,
            followsYou:
              typeof followsYou === 'boolean' ? followsYou : undefined,
          });
        }
      }

      for (const key in node) harvest(node[key], depth + 1);
    }

    function maybeHarvest(url: string, text: string) {
      if (!url.includes('/graphql/') && !url.includes('/api/')) return;
      try {
        harvest(JSON.parse(text));
      } catch {
        /* not JSON, ignore */
      }
    }

    // Patch fetch
    const origFetch = window.fetch;
    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const res = await origFetch.apply(this, args);
      try {
        const req = args[0];
        const url =
          typeof req === 'string'
            ? req
            : req instanceof URL
              ? req.href
              : (req as Request).url;
        if (url && (url.includes('/graphql/') || url.includes('/api/'))) {
          res
            .clone()
            .text()
            .then((t) => maybeHarvest(url, t))
            .catch(() => {});
        }
      } catch {
        /* ignore */
      }
      return res;
    };

    // Patch XMLHttpRequest (X uses this for some endpoints)
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest,
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      (this as any).__xrayUrl = typeof url === 'string' ? url : url.href;
      // @ts-expect-error - forwarding original args
      return origOpen.call(this, method, url, ...rest);
    };
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (this: XMLHttpRequest, ...args) {
      this.addEventListener('load', () => {
        const url = (this as any).__xrayUrl as string | undefined;
        if (
          url &&
          this.responseType === '' &&
          typeof this.responseText === 'string'
        ) {
          maybeHarvest(url, this.responseText);
        }
      });
      return origSend.apply(this, args as any);
    };
  },
});
