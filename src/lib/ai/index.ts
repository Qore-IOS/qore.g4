/**
 * AI Module - Qore AI Chatbot
 *
 * Bu modul Qore sisteminin AI chatbot yeteneklerini saglar.
 *
 * Ana Ozellikler:
 * - Smart Query Engine: Dogal dil sorularini anlar ve coklu veri kaynagindan veri ceker
 * - Entity Resolver: "Line 7", "TSH" gibi dogal dil ifadelerini sistem verilerine esler
 * - Knowledge Base: RAG ile harici dokumanlari (kilavuzlar vb.) AI'a ogretir
 * - Hallucination Guard: Veri uydurmayı engeller
 */

// Core chat functions
export { chat, smartChat, chatStream, smartChatStream } from './chat';
export type { ChatMessage, ChatResponse } from './chat';

// Configuration
export { anthropic, CLAUDE_MODEL, MAX_TOKENS, isApiKeyValid, ERROR_MESSAGES } from './config';

// Query planning
export { planQueries } from './queryPlanner';
export type { QueryType, QueryPlan } from './queryPlanner';

// Data fetching
export { fetchDataForQueries } from './dataFetcher';
export type { FetchedData } from './dataFetcher';

// Smart query engine
export { executeSmartQuery } from './smartQueryEngine';
export type { SmartQueryResult } from './smartQueryEngine';

// Entity resolution
export {
  resolveEntities,
  extractQueryIntent,
  clearEntityCaches,
} from './entityResolver';
export type {
  ResolvedEntity,
  EntityResolutionResult,
  ExtractedQueryIntent,
} from './entityResolver';

// Knowledge base (RAG)
export {
  processDocument,
  retrieveRelevantKnowledge,
  enhanceQueryWithKnowledge,
  listDocuments,
  deleteDocument,
  initializeSampleKnowledge,
} from './knowledgeBase';
export type {
  Document,
  DocumentChunk,
  DocumentCategory,
  RetrievedKnowledge,
} from './knowledgeBase';

// Agent mode
export { runAgent } from './agent';
export { AGENT_TOOLS, pendingPlans } from './tools';
export type { AgentToolName, ToolResult, OrderPlan } from './tools';
