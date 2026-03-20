import type { Config } from '../config.js'
import type { ContentGenerator } from './types.js'
import { OpenAIContentGenerator } from './openai-generator.js'
import { AnthropicContentGenerator } from './anthropic-generator.js'
import { TemplateContentGenerator } from './template-generator.js'
import { logger } from '../logger.js'

const log = logger.child('ai')

export function createContentGenerator(config: Config): ContentGenerator {
  if (config.AI_PROVIDER === 'openai' && config.OPENAI_API_KEY) {
    log.info('using OpenAI content generator')
    return new OpenAIContentGenerator(config.OPENAI_API_KEY, config.AI_MODEL)
  }

  if (config.AI_PROVIDER === 'anthropic' && config.ANTHROPIC_API_KEY) {
    log.info('using Anthropic content generator')
    return new AnthropicContentGenerator(config.ANTHROPIC_API_KEY, config.AI_MODEL)
  }

  log.info('using template content generator (no AI keys configured)')
  return new TemplateContentGenerator()
}
