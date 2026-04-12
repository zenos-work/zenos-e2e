/**
 * Typed HTTP client for Zenos E2E tests.
 * Wraps Playwright's APIRequestContext with typed helpers for the full API surface.
 */

import { APIRequestContext } from '@playwright/test';

export type UserRole = 'READER' | 'AUTHOR' | 'APPROVER' | 'SUPERADMIN';

export interface ZenosUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar_url?: string;
  bio?: string;
  is_active: number;
  needs_topic_preferences: boolean;
}

export interface ZenosArticle {
  id: string;
  title: string;
  slug: string;
  status: string;
  author_id: string;
  content?: string;
  content_type?: string;
  views_count: number;
  likes_count: number;
  comments_count?: number;
  published_at?: string;
  created_at?: string;
  updated_at?: string;
  tags?: string[];
  series_id?: string;
}

export interface ZenosComment {
  id: string;
  article_id: string;
  author_id: string;
  content: string;
  parent_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ZenosNotification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body?: string;
  is_read: boolean;
  created_at?: string;
  metadata?: Record<string, unknown>;
}

export interface ZenosSeries {
  id: string;
  title: string;
  description?: string;
  author_id: string;
  article_count?: number;
  created_at?: string;
}

const TOKEN_MINT_ATTEMPTS = 4;
const TOKEN_MINT_RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryTokenMint(status: number, body: string): boolean {
  return TOKEN_MINT_RETRYABLE_STATUS.has(status)
    || /worker restarted|timeout|temporar|try again|unavailable/i.test(body);
}


/** Normalized response wrapper returned by all client methods */
export class ApiResponse {
  constructor(
    public readonly status: number,
    public readonly ok: boolean,
    private readonly _json: () => Promise<unknown>,
    private readonly _text: () => Promise<string>,
  ) {}

  json<T = unknown>(): Promise<T> { return this._json() as Promise<T>; }
  text(): Promise<string>        { return this._text(); }
}

function wrap(res: Awaited<ReturnType<APIRequestContext['get']>>): ApiResponse {
  return new ApiResponse(res.status(), res.ok(), () => res.json(), () => res.text());
}

function ensureReviewReadyContent(content?: string): string {
  const fallback = '<h2>Introduction</h2><p>This automated article is created by the end to end suite to validate realistic editorial workflows including moderation, submission, approvals, and publication transitions across roles in a stable and repeatable way.</p><p>It intentionally includes many complete sentences so the word count comfortably exceeds moderation minimums and avoids false negatives in tests that expect a successful path from draft to submitted, approved, and published states.</p><p>The narrative mirrors practical engineering communication by describing a problem, proposing implementation details, outlining expected outcomes, and documenting tradeoffs with explicit clarity.</p><p>It also includes additional explanatory language about reliability, auditability, and user impact so content quality checks pass consistently across local and CI environments.</p>';
  const value = (content && content.trim()) ? content.trim() : fallback;
  const wordCount = value.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(Boolean).length;
  if (wordCount >= 90 && value.length >= 50) {
    return value;
  }
  return `${value} <p>This additional paragraph is appended by the E2E client to satisfy minimum content and moderation thresholds consistently across environments while preserving the intent of each test case and avoiding false negatives caused by short payloads.</p>`;
}

export class ZenosApiClient {
  constructor(
    readonly request: APIRequestContext,
    readonly baseUrl: string,
    readonly token: string,
  ) {}

  get authHeaders() {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
      'X-Test-Suite': 'zenos-e2e',
    };
  }

  // ─── Static factory: get a client for any role via dev token endpoint ─────

  static async forRole(request: APIRequestContext, baseUrl: string, role: UserRole): Promise<ZenosApiClient> {
    const secret = process.env.E2E_TEST_AUTH_SECRET;
    let lastError: unknown;

    for (let attempt = 1; attempt <= TOKEN_MINT_ATTEMPTS; attempt += 1) {
      try {
        const res = await request.post(`${baseUrl}/auth/test/token`, {
          headers: { 'Content-Type': 'application/json', ...(secret ? { 'x-e2e-auth-secret': secret } : {}) },
          data: { role },
          timeout: 20_000,
        });

        if (!res.ok()) {
          const bodyText = await res.text();
          const retryable = shouldRetryTokenMint(res.status(), bodyText);
          if (retryable && attempt < TOKEN_MINT_ATTEMPTS) {
            await wait(500 * attempt);
            continue;
          }
          throw new Error(`ZenosApiClient.forRole(${role}) failed: ${res.status()} ${bodyText}`);
        }

        const body = await res.json() as { access_token: string };
        return new ZenosApiClient(request, baseUrl, body.access_token);
      } catch (error) {
        lastError = error;
        if (attempt < TOKEN_MINT_ATTEMPTS) {
          await wait(500 * attempt);
          continue;
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`ZenosApiClient.forRole(${role}) failed after ${TOKEN_MINT_ATTEMPTS} attempts`);
  }

  // ─── Health ───────────────────────────────────────────────────────────────

  async health(): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/health`, { headers: this.authHeaders }));
  }

  // ─── Users ────────────────────────────────────────────────────────────────

  async getMe(): Promise<ZenosUser> {
    const res = await this.request.get(`${this.baseUrl}/api/users/me`, { headers: this.authHeaders });
    if (!res.ok()) throw new Error(`GET /api/users/me failed: ${res.status()}`);
    const body = await res.json() as ZenosUser | { user: ZenosUser };
    return ('user' in body ? body.user : body) as ZenosUser;
  }

  async getUser(userId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/users/${userId}`, { headers: this.authHeaders }));
  }

  async updateMe(data: Partial<{ name: string; bio: string; avatar_url: string }>): Promise<ApiResponse> {
    return wrap(await this.request.put(`${this.baseUrl}/api/users/me`, { headers: this.authHeaders, data }));
  }

  async getMyPreferences(): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/users/me/prefs`, { headers: this.authHeaders }));
  }

  async updateMyPreferences(data: Record<string, unknown>): Promise<ApiResponse> {
    return wrap(await this.request.put(`${this.baseUrl}/api/users/me/prefs`, { headers: this.authHeaders, data }));
  }

  async listUsers(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/users?${qs}`, { headers: this.authHeaders }));
  }

  // ─── Articles ─────────────────────────────────────────────────────────────

  async createArticle(data: {
    title: string;
    content?: string;
    content_type?: string;
    status?: string;
    tags?: string[];
    series_id?: string;
    subtitle?: string;
    reading_level?: string;
  }): Promise<ZenosArticle> {
    const slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + Date.now();
    const res = await this.request.post(`${this.baseUrl}/api/articles`, {
      headers: this.authHeaders,
      data: {
        title: data.title,
        content: ensureReviewReadyContent(data.content),
        content_type: data.content_type ?? 'article',
        status: data.status ?? 'draft',
        slug,
        read_time_minutes: 2,
        tags: data.tags ?? [],
        ...(data.subtitle       ? { subtitle: data.subtitle }           : {}),
        ...(data.series_id      ? { series_id: data.series_id }         : {}),
        ...(data.reading_level  ? { reading_level: data.reading_level } : {}),
      },
    });
    if (!res.ok()) throw new Error(`POST /api/articles failed: ${res.status()} ${await res.text()}`);
    const body = await res.json() as ZenosArticle | { article: ZenosArticle };
    return ('article' in body ? body.article : body) as ZenosArticle;
  }

  async getArticle(id: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/articles/${id}`, { headers: this.authHeaders }));
  }

  async updateArticle(id: string, data: Record<string, unknown>): Promise<ApiResponse> {
    return wrap(await this.request.put(`${this.baseUrl}/api/articles/${id}`, { headers: this.authHeaders, data }));
  }

  async deleteArticle(id: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/articles/${id}`, { headers: this.authHeaders }));
  }

  async getArticles(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/articles?${qs}`, { headers: this.authHeaders }));
  }

  async getMyArticles(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/articles/mine?${qs}`, { headers: this.authHeaders }));
  }

  async submitArticle(id: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/articles/${id}/submit`, { headers: this.authHeaders }));
  }

  async approveArticle(id: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/articles/${id}/approve`, { headers: this.authHeaders }));
  }

  async rejectArticle(id: string, reason: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/articles/${id}/reject`, {
      headers: this.authHeaders, data: { note: reason },
    }));
  }

  async publishArticle(id: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/articles/${id}/publish`, { headers: this.authHeaders }));
  }

  async archiveArticle(id: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/articles/${id}/archive`, { headers: this.authHeaders }));
  }

  async getRelatedArticles(id: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/articles/${id}/related`, { headers: this.authHeaders }));
  }

  async getArticleSeries(id: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/articles/${id}/series`, { headers: this.authHeaders }));
  }

  // ─── Comments ─────────────────────────────────────────────────────────────

  async getComments(articleId: string, params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams({ article_id: articleId, ...params }).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/comments?${qs}`, { headers: this.authHeaders }));
  }

  async postComment(articleId: string, content: string, parentId?: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/comments`, {
      headers: this.authHeaders,
      data: { article_id: articleId, content, ...(parentId ? { parent_id: parentId } : {}) },
    }));
  }

  async editComment(commentId: string, content: string): Promise<ApiResponse> {
    return wrap(await this.request.put(`${this.baseUrl}/api/comments/${commentId}`, {
      headers: this.authHeaders, data: { content },
    }));
  }

  async deleteComment(commentId: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/comments/${commentId}`, { headers: this.authHeaders }));
  }

  async getReplies(commentId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/comments/${commentId}/replies`, { headers: this.authHeaders }));
  }

  async flagComment(commentId: string, reason: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/comments/${commentId}/flag`, {
      headers: this.authHeaders, data: { reason },
    }));
  }

  async createComment(articleId: string, content: string, parentId?: string): Promise<ZenosComment> {
    const res = await this.postComment(articleId, content, parentId);
    if (!res.ok) throw new Error(`POST /api/comments failed: ${res.status}`);
    const body = await res.json() as { comment: ZenosComment } | ZenosComment;
    return ('comment' in body ? (body as { comment: ZenosComment }).comment : body) as ZenosComment;
  }

  // ─── Notifications ────────────────────────────────────────────────────────

  async getUserNotifications(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/admin/notifications?${qs}`, { headers: this.authHeaders }));
  }

  async markNotificationRead(notificationId: string): Promise<ApiResponse> {
    return wrap(await this.request.put(`${this.baseUrl}/api/admin/notifications/${notificationId}/read`, {
      headers: this.authHeaders, data: {},
    }));
  }

  async markAllNotificationsRead(): Promise<ApiResponse> {
    return wrap(await this.request.put(`${this.baseUrl}/api/admin/notifications/read`, {
      headers: this.authHeaders, data: {},
    }));
  }

  // ─── Social ───────────────────────────────────────────────────────────────

  async likeArticle(articleId: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/social/likes/${articleId}`, {
      headers: this.authHeaders, data: {},
    }));
  }

  async unlikeArticle(articleId: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/social/likes/${articleId}`, { headers: this.authHeaders }));
  }

  async checkLike(articleId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/social/likes/${articleId}/check`, { headers: this.authHeaders }));
  }

  async getLikeStats(articleId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/social/likes/${articleId}/stats`, { headers: this.authHeaders }));
  }

  async bookmarkArticle(articleId: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/social/bookmarks/${articleId}`, {
      headers: this.authHeaders, data: {},
    }));
  }

  async unbookmarkArticle(articleId: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/social/bookmarks/${articleId}`, { headers: this.authHeaders }));
  }

  async getBookmarks(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/social/bookmarks?${qs}`, { headers: this.authHeaders }));
  }

  async checkBookmark(articleId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/social/bookmarks/${articleId}/check`, { headers: this.authHeaders }));
  }

  async followUser(userId: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/social/follows/${userId}`, {
      headers: this.authHeaders, data: {},
    }));
  }

  async unfollowUser(userId: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/social/follows/${userId}`, { headers: this.authHeaders }));
  }

  async checkFollow(userId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/social/follows/${userId}/check`, { headers: this.authHeaders }));
  }

  async getFollowers(userId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/social/followers/${userId}`, { headers: this.authHeaders }));
  }

  async getFollowing(userId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/social/following/${userId}`, { headers: this.authHeaders }));
  }

  async getFollowStats(userId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/social/stats/${userId}`, { headers: this.authHeaders }));
  }

  async addReaction(articleId: string, reactionType: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/social/reactions/${articleId}`, {
      headers: this.authHeaders, data: { reaction_type: reactionType },
    }));
  }

  async getReactions(articleId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/social/reactions/${articleId}`, { headers: this.authHeaders }));
  }

  async removeReaction(articleId: string, reactionType: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/social/reactions/${articleId}/${reactionType}`, { headers: this.authHeaders }));
  }

  async recordShare(articleId: string, platform: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/social/shares/${articleId}`, {
      headers: this.authHeaders, data: { provider: platform },
    }));
  }

  async getSocialAccounts(): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/social/accounts`, { headers: this.authHeaders }));
  }

  async connectSocialAccount(data: {
    provider: string;
    provider_uid: string;
    handle?: string;
    access_token?: string;
    refresh_token?: string;
    token_expires_at?: number;
  }): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/social/accounts/connect`, {
      headers: this.authHeaders,
      data,
    }));
  }

  async disconnectSocialAccount(provider: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/social/accounts/${provider}`, {
      headers: this.authHeaders,
    }));
  }

  async getShareUrl(articleId: string, provider: string, articleUrl: string, title?: string): Promise<ApiResponse> {
    const qs = new URLSearchParams({ article_url: articleUrl, ...(title ? { title } : {}) }).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/social/share-url/${articleId}/${provider}?${qs}`, {
      headers: this.authHeaders,
    }));
  }

  // ─── Workflows ───────────────────────────────────────────────────────────

  async createWorkflow(data: {
    name: string;
    description?: string;
    status?: string;
    definition?: Record<string, unknown>;
    org_id?: string;
  }): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/workflows`, {
      headers: this.authHeaders,
      data,
    }));
  }

  async getWorkflows(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/workflows?${qs}`, { headers: this.authHeaders }));
  }

  async getWorkflow(workflowId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/workflows/${workflowId}`, { headers: this.authHeaders }));
  }

  async updateWorkflow(workflowId: string, data: Record<string, unknown>): Promise<ApiResponse> {
    return wrap(await this.request.put(`${this.baseUrl}/api/workflows/${workflowId}`, {
      headers: this.authHeaders,
      data,
    }));
  }

  async deleteWorkflow(workflowId: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/workflows/${workflowId}`, { headers: this.authHeaders }));
  }

  async getWorkflowVersions(workflowId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/workflows/${workflowId}/versions`, { headers: this.authHeaders }));
  }

  async createWorkflowVersion(workflowId: string, changelog?: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/workflows/${workflowId}/versions`, {
      headers: this.authHeaders,
      data: { changelog: changelog ?? '' },
    }));
  }

  async restoreWorkflowVersion(workflowId: string, versionNumber: number): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/workflows/${workflowId}/versions/${versionNumber}/restore`, {
      headers: this.authHeaders,
      data: {},
    }));
  }

  // ─── Community ───────────────────────────────────────────────────────────

  async getCommunitySpaces(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/community?${qs}`, { headers: this.authHeaders }));
  }

  async createCommunitySpace(data: {
    name: string;
    slug: string;
    org_id?: string;
    description?: string;
    space_type?: string;
  }): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/community`, {
      headers: this.authHeaders,
      data,
    }));
  }

  async getCommunitySpace(spaceId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/community/${spaceId}`, { headers: this.authHeaders }));
  }

  async deleteCommunitySpace(spaceId: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/community/${spaceId}`, { headers: this.authHeaders }));
  }

  async getCommunityMembers(spaceId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/community/${spaceId}/members`, { headers: this.authHeaders }));
  }

  async joinCommunitySpace(spaceId: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/community/${spaceId}/members`, {
      headers: this.authHeaders,
      data: {},
    }));
  }

  async leaveCommunitySpace(spaceId: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/community/${spaceId}/members`, { headers: this.authHeaders }));
  }

  async getCommunityPosts(spaceId: string, params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/community/${spaceId}/posts?${qs}`, { headers: this.authHeaders }));
  }

  async createCommunityPost(spaceId: string, data: {
    title: string;
    body: string;
    post_type?: string;
    parent_id?: string;
  }): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/community/${spaceId}/posts`, {
      headers: this.authHeaders,
      data,
    }));
  }

  async getCommunityReplies(spaceId: string, postId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/community/${spaceId}/posts/${postId}/replies`, { headers: this.authHeaders }));
  }

  async likeCommunityPost(spaceId: string, postId: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/community/${spaceId}/posts/${postId}/like`, {
      headers: this.authHeaders,
      data: {},
    }));
  }

  // ─── Marketplace ────────────────────────────────────────────────────────

  async getMarketplaceItems(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/marketplace?${qs}`, { headers: this.authHeaders }));
  }

  async createMarketplaceItem(data: {
    name: string;
    slug: string;
    short_desc?: string;
    category?: string;
    item_type?: string;
    price_cents?: number;
    currency?: string;
  }): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/marketplace`, {
      headers: this.authHeaders,
      data,
    }));
  }

  async getMarketplaceItem(itemId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/marketplace/${itemId}`, { headers: this.authHeaders }));
  }

  async deleteMarketplaceItem(itemId: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/marketplace/${itemId}`, { headers: this.authHeaders }));
  }

  async publishMarketplaceItem(itemId: string): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/marketplace/${itemId}/publish`, {
      headers: this.authHeaders,
      data: {},
    }));
  }

  async purchaseMarketplaceItem(itemId: string, data: { price_paid_cents?: number; currency?: string } = {}): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/marketplace/${itemId}/purchases`, {
      headers: this.authHeaders,
      data,
    }));
  }

  async getMarketplacePurchases(itemId: string, params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/marketplace/${itemId}/purchases?${qs}`, { headers: this.authHeaders }));
  }

  async getMyMarketplacePurchases(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/marketplace/my-purchases?${qs}`, { headers: this.authHeaders }));
  }

  async getMarketplaceReviews(itemId: string, params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/marketplace/${itemId}/reviews?${qs}`, { headers: this.authHeaders }));
  }

  async createMarketplaceReview(itemId: string, data: { rating: number; body?: string }): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/marketplace/${itemId}/reviews`, {
      headers: this.authHeaders,
      data,
    }));
  }

  // ─── Series ───────────────────────────────────────────────────────────────

  async createSeries(data: { title: string; description?: string }): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/series`, {
      headers: this.authHeaders,
      data: { name: data.title, description: data.description },
    }));
  }

  async getSeries(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/series?${qs}`, { headers: this.authHeaders }));
  }

  async getSeriesById(seriesId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/series/${seriesId}`, { headers: this.authHeaders }));
  }

  async getSeriesArticles(seriesId: string): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/series/${seriesId}/articles`, { headers: this.authHeaders }));
  }

  async updateSeries(seriesId: string, data: Partial<ZenosSeries>): Promise<ApiResponse> {
    const body: Record<string, unknown> = { ...data };
    if ('title' in body && !('name' in body)) {
      body['name'] = body['title'];
      delete body['title'];
    }
    return wrap(await this.request.put(`${this.baseUrl}/api/series/${seriesId}`, { headers: this.authHeaders, data: body }));
  }

  async deleteSeries(seriesId: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/series/${seriesId}`, { headers: this.authHeaders }));
  }

  async addArticleToSeries(seriesId: string, articleId: string, order?: number): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/series/${seriesId}/articles/${articleId}`, {
      headers: this.authHeaders,
      data: { ...(order !== undefined ? { order } : {}) },
    }));
  }

  async removeArticleFromSeries(seriesId: string, articleId: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/series/${seriesId}/articles/${articleId}`, {
      headers: this.authHeaders,
    }));
  }

  // ─── Tags ─────────────────────────────────────────────────────────────────

  async getTags(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/tags?${qs}`, { headers: this.authHeaders }));
  }

  // ─── Search ───────────────────────────────────────────────────────────────

  async search(query: string, type?: string): Promise<ApiResponse> {
    const qs = new URLSearchParams({ q: query, ...(type ? { type } : {}) }).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/search?${qs}`, { headers: this.authHeaders }));
  }

  // ─── Feed ─────────────────────────────────────────────────────────────────

  async getFeed(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/feed?${qs}`, { headers: this.authHeaders }));
  }

  // ─── Analytics / Stats ────────────────────────────────────────────────────

  async getStats(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/analytics/stats?${qs}`, { headers: this.authHeaders }));
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  async getAdminStats(): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/admin/stats`, { headers: this.authHeaders }));
  }

  async getAdminQueue(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/admin/queue?${qs}`, { headers: this.authHeaders }));
  }

  async bulkQueueAction(data: { action: string; article_ids: string[] }): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/admin/queue/bulk`, { headers: this.authHeaders, data }));
  }

  async getAdminUsers(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/admin/users?${qs}`, { headers: this.authHeaders }));
  }

  async getAdminRankingWeights(): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/admin/ranking-weights`, { headers: this.authHeaders }));
  }

  async updateAdminRankingWeights(data: Record<string, number>): Promise<ApiResponse> {
    return wrap(await this.request.put(`${this.baseUrl}/api/admin/ranking-weights`, { headers: this.authHeaders, data }));
  }

  async getAdminSuccessSignals(): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/admin/success-signals`, { headers: this.authHeaders }));
  }

  async getAdminContentTypes(): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/admin/content-types`, { headers: this.authHeaders }));
  }

  async getAdminNotifications(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/admin/notifications?${qs}`, { headers: this.authHeaders }));
  }

  async adminBanUser(userId: string): Promise<ApiResponse> {
    return wrap(await this.request.put(`${this.baseUrl}/api/admin/users/${userId}/ban`, {
      headers: this.authHeaders, data: { reason: 'E2E test ban' },
    }));
  }

  async adminUnbanUser(userId: string): Promise<ApiResponse> {
    return wrap(await this.request.put(`${this.baseUrl}/api/admin/users/${userId}/unban`, {
      headers: this.authHeaders, data: {},
    }));
  }

  async getAdminFeatureFlags(): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/admin/feature-flags`, { headers: this.authHeaders }));
  }

  async createAdminFeatureFlag(data: Record<string, unknown>): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/admin/feature-flags`, {
      headers: this.authHeaders,
      data,
    }));
  }

  async updateAdminFeatureFlag(flagId: string, data: Record<string, unknown>): Promise<ApiResponse> {
    return wrap(await this.request.put(`${this.baseUrl}/api/admin/feature-flags/${flagId}`, {
      headers: this.authHeaders,
      data,
    }));
  }

  async previewAdminFeatureAnnouncement(data: Record<string, unknown>): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/admin/feature-flags/preview-announcement`, {
      headers: this.authHeaders,
      data,
    }));
  }

  // ─── Membership ───────────────────────────────────────────────────────────

  async getMembershipPlans(): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/membership/plans`, { headers: this.authHeaders }));
  }

  async getMyMembership(): Promise<ApiResponse> {
    return wrap(await this.request.get(`${this.baseUrl}/api/membership/me`, { headers: this.authHeaders }));
  }

  async upgradeMembership(data: {
    tier: 'free' | 'creator_pro' | 'team_suite';
    stripe_subscription_id?: string;
  }): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/membership/upgrade`, {
      headers: this.authHeaders,
      data,
    }));
  }

  async trackPremiumRead(data: {
    article_id: string;
    scroll_depth?: number;
    duration_seconds?: number;
  }): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/membership/premium-read`, {
      headers: this.authHeaders,
      data,
    }));
  }

  async logPremiumFunnelEvent(data: {
    event_type: string;
    article_id?: string;
    device_type?: string;
    referrer?: string;
    ip_hash?: string;
  }): Promise<ApiResponse> {
    return wrap(await this.request.post(`${this.baseUrl}/api/membership/funnel-event`, {
      headers: this.authHeaders,
      data,
    }));
  }

  // ─── Reading History ─────────────────────────────────────────────────────

  async getReadingHistory(params: Record<string, string> = {}): Promise<ApiResponse> {
    const qs = new URLSearchParams(params).toString();
    return wrap(await this.request.get(`${this.baseUrl}/api/users/me/reading-history?${qs}`, { headers: this.authHeaders }));
  }

  async upsertReadingHistoryItem(data: {
    article_id: string;
    slug: string;
    title: string;
    subtitle?: string;
    author_name?: string;
    cover_image_url?: string;
    read_time_minutes: number;
    progress: number;
    last_read_at?: string;
  }): Promise<ApiResponse> {
    return wrap(await this.request.put(`${this.baseUrl}/api/users/me/reading-history`, {
      headers: this.authHeaders,
      data,
    }));
  }

  async removeReadingHistoryItem(articleId: string): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/users/me/reading-history/${articleId}`, {
      headers: this.authHeaders,
    }));
  }

  async clearReadingHistory(): Promise<ApiResponse> {
    return wrap(await this.request.delete(`${this.baseUrl}/api/users/me/reading-history`, {
      headers: this.authHeaders,
    }));
  }
}
