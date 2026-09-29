// Reddit Data API adapter. Uses an OAuth "script" app (client credentials) so reads are authenticated and rate-limited at
// 100 requests/minute instead of the anonymous throttle that answers 429 to cloud IPs. Needs REDDIT_CLIENT_ID and
// REDDIT_CLIENT_SECRET; without them the source is skipped with a clear log line, never silently.
import type { ParsedItem } from './parse.js';

let tokenP: Promise<{ token: string; exp: number }> | null = null;

async function token(ua: string): Promise<string> {
  const id = process.env.REDDIT_CLIENT_ID, secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) throw new Error('REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET not set');
  if (!tokenP || (await tokenP).exp < Date.now() + 60_000) {
    tokenP = (async () => {
      const r = await fetch('https://www.reddit.com/api/v1/access_token', {
        method: 'POST',
        headers: { authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded', 'user-agent': ua },
        body: 'grant_type=client_credentials',
      });
      if (!r.ok) throw new Error(`reddit token: ${r.status} ${await r.text()}`);
      const j = await r.json() as { access_token: string; expires_in: number };
      return { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
    })();
  }
  return (await tokenP).token;
}

export function isRedditSource(url: string): boolean { try { return /(^|\.)reddit\.com$/i.test(new URL(url).hostname); } catch { return false; } }

/** New posts in a subreddit, as pipeline items. The source url names the subreddit (any reddit.com/r/<name>/… form). */
export async function fetchSubreddit(sourceUrl: string, ua: string, limit = 50): Promise<{ status: number; items: ParsedItem[] }> {
  const sub = /\/r\/([A-Za-z0-9_]+)/.exec(sourceUrl)?.[1];
  if (!sub) throw new Error(`no subreddit in ${sourceUrl}`);
  const t = await token(ua);
  const r = await fetch(`https://oauth.reddit.com/r/${sub}/new?limit=${limit}&raw_json=1`, { headers: { authorization: `Bearer ${t}`, 'user-agent': ua } });
  if (!r.ok) return { status: r.status, items: [] };
  const j = await r.json() as { data: { children: { data: Record<string, unknown> }[] } };
  const items = j.data.children.map(({ data: p }) => {
    const permalink = `https://www.reddit.com${p.permalink as string}`;
    const self = p.is_self as boolean;
    const body = self ? (p.selftext as string) : '';
    return {
      guid: `t3_${p.id as string}`,
      url: permalink,                                   // always the thread: that is what a reader reacts to
      title: p.title as string,
      summary: body ? body.replace(/\s+/g, ' ').trim().slice(0, 600) : (self ? null : `Link post → ${p.url as string}`),
      body: body ? body.replace(/\s+/g, ' ').trim().slice(0, 4000) : null,
      publishedAt: new Date((p.created_utc as number) * 1000),
      categories: [String(p.link_flair_text ?? '')].filter(Boolean).concat([`score:${p.score as number}`, `comments:${p.num_comments as number}`]),
    } satisfies ParsedItem;
  });
  return { status: 200, items };
}

/** Top-level comments on a Reddit thread (best first), for the sampled-thread read. Needs the same script-app credentials. */
export async function fetchRedditComments(threadUrl: string, ua: string, limit = 40): Promise<{ id: string; author: string | null; text: string; score: number; created: Date | null }[]> {
  const m = /reddit\.com\/r\/([A-Za-z0-9_]+)\/comments\/([a-z0-9]+)/i.exec(threadUrl); if (!m) return [];
  const t = await token(ua);
  const r = await fetch(`https://oauth.reddit.com/r/${m[1]}/comments/${m[2]}?sort=top&limit=${limit}&depth=1&raw_json=1`, { headers: { authorization: `Bearer ${t}`, 'user-agent': ua } });
  if (!r.ok) throw new Error(`reddit comments ${r.status}`);
  const j = await r.json() as { data: { children: { kind: string; data: Record<string, unknown> }[] } }[];
  const list = j[1]?.data?.children ?? [];
  return list.filter(c => c.kind === 't1' && c.data.body && !/^\[(removed|deleted)\]$/.test(String(c.data.body))).slice(0, limit)
    .map(c => ({ id: String(c.data.id), author: (c.data.author as string) ?? null, text: String(c.data.body).replace(/\s+/g, ' ').trim(), score: Number(c.data.score ?? 0), created: c.data.created_utc ? new Date(Number(c.data.created_utc) * 1000) : null }));
}
