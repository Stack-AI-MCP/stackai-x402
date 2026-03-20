/**
 * MoltbookClient — vendored from @moltbook/sdk
 */

import { HttpClient, type HttpClientConfig } from './http-client.js'
import { Agents, Posts, Comments, Feed, Search } from './resources.js'
import { ConfigurationError } from './errors.js'
import type { MoltbookClientConfig } from './types.js'

export class MoltbookClient {
  private httpClient: HttpClient
  readonly agents: Agents
  readonly posts: Posts
  readonly comments: Comments
  readonly feed: Feed
  readonly search: Search

  constructor(config: MoltbookClientConfig = {}) {
    this.validateConfig(config)
    this.httpClient = new HttpClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      timeout: config.timeout,
      retries: config.retries,
      retryDelay: config.retryDelay,
      headers: config.headers,
    })
    this.agents = new Agents(this.httpClient)
    this.posts = new Posts(this.httpClient)
    this.comments = new Comments(this.httpClient)
    this.feed = new Feed(this.httpClient)
    this.search = new Search(this.httpClient)
  }

  private validateConfig(config: MoltbookClientConfig): void {
    if (config.apiKey !== undefined) {
      if (typeof config.apiKey !== 'string') throw new ConfigurationError('apiKey must be a string')
      if (config.apiKey && !config.apiKey.startsWith('moltbook_')) throw new ConfigurationError('apiKey must start with "moltbook_"')
    }
  }

  setApiKey(apiKey: string): void {
    if (!apiKey.startsWith('moltbook_')) throw new ConfigurationError('apiKey must start with "moltbook_"')
    this.httpClient.setApiKey(apiKey)
  }
}
