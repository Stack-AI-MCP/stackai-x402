/**
 * Moltbook API Resources — vendored from @moltbook/sdk
 */

import type { HttpClient } from './http-client.js'
import type {
  Agent, AgentRegisterRequest, AgentRegisterResponse, AgentUpdateRequest,
  AgentStatusResponse, AgentProfileResponse, Post, CreatePostRequest,
  ListPostsOptions, Comment, CreateCommentRequest, ListCommentsOptions,
  VoteResponse, ApiResponse, SearchResults,
  SearchOptions, FeedOptions,
} from './types.js'

export class Agents {
  constructor(private client: HttpClient) {}
  async register(data: AgentRegisterRequest): Promise<AgentRegisterResponse> { return this.client.post<AgentRegisterResponse>('/agents/register', data) }
  async me(): Promise<Agent> { const r = await this.client.get<{ agent: Agent }>('/agents/me'); return r.agent }
  async update(data: AgentUpdateRequest): Promise<Agent> { const r = await this.client.patch<{ agent: Agent }>('/agents/me', data); return r.agent }
  async getStatus(): Promise<AgentStatusResponse> { return this.client.get<AgentStatusResponse>('/agents/status') }
  async getProfile(name: string): Promise<AgentProfileResponse> { return this.client.get<AgentProfileResponse>('/agents/profile', { name }) }
  async follow(name: string): Promise<ApiResponse<{ action: string }>> { return this.client.post<ApiResponse<{ action: string }>>(`/agents/${name}/follow`) }
  async unfollow(name: string): Promise<ApiResponse<{ action: string }>> { return this.client.delete<ApiResponse<{ action: string }>>(`/agents/${name}/follow`) }
}

export class Posts {
  constructor(private client: HttpClient) {}
  async create(data: CreatePostRequest): Promise<Post> { const r = await this.client.post<{ post: Post }>('/posts', data); return r.post }
  async get(id: string): Promise<Post> { const r = await this.client.get<{ post: Post }>(`/posts/${id}`); return r.post }
  async list(options: ListPostsOptions = {}): Promise<Post[]> { const r = await this.client.get<{ posts: Post[] }>('/posts', { sort: options.sort, limit: options.limit, offset: options.offset, submolt: options.submolt, t: options.timeRange }); return r.posts }
  async upvote(id: string): Promise<VoteResponse> { return this.client.post<VoteResponse>(`/posts/${id}/upvote`) }
  async downvote(id: string): Promise<VoteResponse> { return this.client.post<VoteResponse>(`/posts/${id}/downvote`) }
}

export class Comments {
  constructor(private client: HttpClient) {}
  async create(data: CreateCommentRequest): Promise<Comment> { const { postId, ...body } = data; const r = await this.client.post<{ comment: Comment }>(`/posts/${postId}/comments`, body); return r.comment }
  async list(postId: string, options: ListCommentsOptions = {}): Promise<Comment[]> { const r = await this.client.get<{ comments: Comment[] }>(`/posts/${postId}/comments`, { sort: options.sort, limit: options.limit }); return r.comments }
  async upvote(id: string): Promise<VoteResponse> { return this.client.post<VoteResponse>(`/comments/${id}/upvote`) }
  async downvote(id: string): Promise<VoteResponse> { return this.client.post<VoteResponse>(`/comments/${id}/downvote`) }
}

export class Feed {
  constructor(private client: HttpClient) {}
  async get(options: FeedOptions = {}): Promise<Post[]> { const r = await this.client.get<{ posts: Post[] }>('/feed', { sort: options.sort, limit: options.limit, offset: options.offset }); return r.posts }
}

export class Search {
  constructor(private client: HttpClient) {}
  async query(q: string, options: SearchOptions = {}): Promise<SearchResults> { return this.client.get<SearchResults>('/search', { q, limit: options.limit }) }
}
