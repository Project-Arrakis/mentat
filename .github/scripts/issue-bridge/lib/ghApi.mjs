// ACP Issue Bridge — minimal GitHub REST client.
//
// Deliberately dependency-free: uses the platform `fetch` (Node >=20 / the
// GitHub Actions `ubuntu-24.04` runner both provide it) instead of adding
// @octokit/rest as a dependency for what is, in this bridge, a small,
// fixed set of REST calls (section 84, "minimal dependencies").
//
// Implements bounded retry with exponential backoff for transient failures
// (section 62), honors `Retry-After`, and never retries permanent
// authorization errors. Never logs the Authorization header or token value
// (section 6/84 — no secrets in logs).

import { classifyError, transientError, rateLimitError, authorizationError } from "./errors.mjs";

const DEFAULT_BACKOFF_MS = [2000, 5000, 15000, 30000];

function redactHeaders(headers) {
  const clone = { ...headers };
  if (clone.Authorization) clone.Authorization = "[REDACTED]";
  if (clone.authorization) clone.authorization = "[REDACTED]";
  return clone;
}

function sleepDefault(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GitHubClient {
  /**
   * @param {object} opts
   * @param {() => (string | Promise<string>)} opts.getToken - lazily
   *   resolves the installation token just-in-time (section 6: never
   *   persisted, never logged).
   * @param {string} [opts.baseUrl]
   * @param {typeof fetch} [opts.fetchImpl]
   * @param {(ms:number) => Promise<void>} [opts.sleepImpl]
   * @param {number[]} [opts.backoffMs]
   * @param {string} [opts.userAgent]
   */
  constructor({
    getToken,
    baseUrl = "https://api.github.com",
    fetchImpl = fetch,
    sleepImpl = sleepDefault,
    backoffMs = DEFAULT_BACKOFF_MS,
    userAgent = "acp-issue-bridge"
  }) {
    if (typeof getToken !== "function") {
      throw new Error("GitHubClient requires getToken() so tokens are minted just-in-time");
    }
    this.getToken = getToken;
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.sleepImpl = sleepImpl;
    this.backoffMs = backoffMs;
    this.userAgent = userAgent;
  }

  async request(method, path, { body, headers = {}, accept } = {}) {
    const token = await this.getToken();
    const url = path.startsWith("http") ? path : `${this.baseUrl}${path}`;
    const requestHeaders = {
      Authorization: `Bearer ${token}`,
      Accept: accept || "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": this.userAgent,
      ...headers
    };
    if (body !== undefined) requestHeaders["Content-Type"] = "application/json";

    let attempt = 0;
    // attempt 0 is the first try; backoffMs.length additional retries.
    for (;;) {
      let response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers: requestHeaders,
          body: body === undefined ? undefined : JSON.stringify(body)
        });
      } catch (networkErr) {
        const classified = transientError(`network error calling ${method} ${path}: ${networkErr.message}`, {
          method,
          path
        });
        if (attempt >= this.backoffMs.length) throw classified;
        await this.sleepImpl(this.backoffMs[attempt]);
        attempt += 1;
        continue;
      }

      if (response.ok) {
        if (response.status === 204) return null;
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      }

      const status = response.status;
      const retryAfterHeader = response.headers.get("retry-after");
      const rateRemaining = response.headers.get("x-ratelimit-remaining");
      let payload;
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      const message = payload && payload.message ? payload.message : `HTTP ${status}`;

      const isRateLimited = status === 429 || (status === 403 && (retryAfterHeader || rateRemaining === "0"));
      const isTransient = status === 502 || status === 503 || status === 504;
      const isRetryable = isRateLimited || isTransient;

      if (!isRetryable) {
        if (status === 401 || status === 403) {
          throw authorizationError(message, { status, method, path, headers: redactHeaders(requestHeaders) });
        }
        throw classifyError({ status, message });
      }

      if (attempt >= this.backoffMs.length) {
        throw isRateLimited
          ? rateLimitError(message, { status, method, path })
          : transientError(message, { status, method, path });
      }

      const waitMs = retryAfterHeader
        ? Number.parseInt(retryAfterHeader, 10) * 1000
        : this.backoffMs[attempt];
      await this.sleepImpl(Number.isFinite(waitMs) && waitMs > 0 ? waitMs : this.backoffMs[attempt]);
      attempt += 1;
    }
  }

  get(path, opts) {
    return this.request("GET", path, opts);
  }
  post(path, body, opts) {
    return this.request("POST", path, { ...opts, body });
  }
  patch(path, body, opts) {
    return this.request("PATCH", path, { ...opts, body });
  }
  put(path, body, opts) {
    return this.request("PUT", path, { ...opts, body });
  }
  delete(path, opts) {
    return this.request("DELETE", path, opts);
  }

  // --- Convenience wrappers for the exact calls the bridge needs ---

  createIssue(repoSlug, { title, body, labels }) {
    return this.post(`/repos/${repoSlug}/issues`, { title, body, labels });
  }

  getIssue(repoSlug, issueNumber) {
    return this.get(`/repos/${repoSlug}/issues/${issueNumber}`);
  }

  updateIssue(repoSlug, issueNumber, patch) {
    return this.patch(`/repos/${repoSlug}/issues/${issueNumber}`, patch);
  }

  addLabels(repoSlug, issueNumber, labels) {
    return this.post(`/repos/${repoSlug}/issues/${issueNumber}/labels`, { labels });
  }

  async removeLabel(repoSlug, issueNumber, label) {
    try {
      return await this.delete(`/repos/${repoSlug}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`);
    } catch (err) {
      const classified = classifyError(err);
      // Removing a label that is already absent is not an error condition.
      if (classified.details && classified.details.status === 404) return null;
      throw classified;
    }
  }

  listComments(repoSlug, issueNumber, { perPage = 100 } = {}) {
    return this.get(`/repos/${repoSlug}/issues/${issueNumber}/comments?per_page=${perPage}`);
  }

  createComment(repoSlug, issueNumber, body) {
    return this.post(`/repos/${repoSlug}/issues/${issueNumber}/comments`, { body });
  }

  searchIssues(query) {
    return this.get(`/search/issues?q=${encodeURIComponent(query)}&per_page=50`);
  }

  listLabels(repoSlug) {
    return this.get(`/repos/${repoSlug}/labels?per_page=100`);
  }

  createLabel(repoSlug, { name, color, description }) {
    return this.post(`/repos/${repoSlug}/labels`, { name, color, description });
  }

  /**
   * Returns the precise role ("admin"|"maintain"|"write"|"triage"|"read"|
   * "none"|custom-role-slug) for a user on a repo — deliberately `role_name`,
   * not the legacy `permission` field, which collapses `maintain`->`write`
   * and `triage`->`read` (see auth.mjs's module doc comment for why this
   * matters for the authorization matrix).
   */
  async getUserRole(repoSlug, username) {
    const result = await this.get(`/repos/${repoSlug}/collaborators/${encodeURIComponent(username)}/permission`);
    return (result && (result.role_name || result.permission)) || "none";
  }
}

export { DEFAULT_BACKOFF_MS };
