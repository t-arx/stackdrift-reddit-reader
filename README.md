# Stack Drift · Reddit reader

The Reddit Data API adapter used by [Stack Drift](https://stackdrift.ai), an enterprise AI insights site.

What it does, and all it does:

- Authenticates as a **script app** with client credentials (no user login, no user data).
- Reads **new posts** in a fixed list of public subreddits (`/r/<name>/new`, up to 50 at a time).
- Reads the **top-level comments** of a thread that a person on our register has reacted to (`/r/<name>/comments/<id>`, top 40, depth 1).
- Stays under 100 requests a minute; one request at a time per host, spaced out.

What it never does: post, comment, vote, message, moderate, edit a profile, or store anything about a Reddit user beyond the public author name and permalink shown with a verbatim, linked excerpt back to the thread.

`reddit.ts` is the whole adapter.
