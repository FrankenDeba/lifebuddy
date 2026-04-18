// Vector Store - Pinecone Integration
// For semantic memory retrieval

import { Pinecone } from '@pinecone-database/pinecone';

export class VectorStore {
  constructor(apiKey, indexName = 'lifebuddy') {
    this.indexName = indexName;
    this.dimension = 1536; // Claude embeddings dimension
    this.client = null;
    this.index = null;
    this.initialized = false;
    
    if (apiKey) {
      this.init(apiKey);
    }
  }

  /**
   * Initialize Pinecone client
   */
  async init(apiKey) {
    try {
      this.client = new Pinecone({ apiKey });
      
      // Get or create index
      try {
        this.index = this.client.Index(this.indexName);
      } catch (e) {
        console.warn('Vector index not found. Run setup to create.');
      }
      
      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize Pinecone:', error);
    }
  }

  /**
   * Check if initialized
   */
  isReady() {
    return this.initialized && this.index !== null;
  }

  /**
   * Upsert vectors for entries
   */
  async upsertEntries(entries, userId) {
    if (!this.isReady()) return;
    
    const vectors = entries.map((entry, i) => ({
      id: entry.id,
      values: entry.embedding || this.generatePlaceholderEmbedding(),
      metadata: {
        userId,
        entryId: entry.id,
        content: entry.content?.substring(0, 1000),
        type: entry.type || entry.entryType,
        timestamp: new Date(entry.timestamp).toISOString()
      }
    }));
    
    try {
      await this.index.upsert(vectors);
    } catch (error) {
      console.error('Failed to upsert vectors:', error);
    }
  }

  /**
   * Query for similar entries
   */
  async querySimilar(query, userId, options = {}) {
    if (!this.isReady()) return [];
    
    const topK = options.topK || 5;
    const filter = userId ? { userId } : {};
    
    // Generate query embedding
    // Note: Would use actual embedding model in production
    const queryEmbedding = options.embedding || this.generatePlaceholderEmbedding();
    
    try {
      const result = await this.index.query({
        vector: queryEmbedding,
        topK,
        filter,
        includeMetadata: true
      });
      
      return result.matches || [];
    } catch (error) {
      console.error('Failed to query vectors:', error);
      return [];
    }
  }

  /**
   * Delete vectors for entries
   */
  async deleteEntries(entryIds) {
    if (!this.isReady()) return;
    
    try {
      await this.index.deleteMany(entryIds);
    } catch (error) {
      console.error('Failed to delete vectors:', error);
    }
  }

  /**
   * Generate placeholder embedding
   * Note: In production, use Claude embeddings API
   */
  generatePlaceholderEmbedding() {
    // Placeholder - generate random vector for testing
    const embedding = new Array(this.dimension);
    for (let i = 0; i < this.dimension; i++) {
      embedding[i] = (Math.random() * 2) - 1;
    }
    
    // Normalize
    const mag = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
    return embedding.map(v => v / mag);
  }

  /**
   * Create embedding from text using Anthropic
   * Note: Claude doesn't have built-in embeddings, would need separate service
   */
  async createEmbedding(text) {
    // Placeholder for embedding creation
    // In production, use OpenAI embeddings or similar
    console.warn('Embedding creation not implemented - using placeholder');
    return this.generatePlaceholderEmbedding();
  }

  /**
   * Get index statistics
   */
  async getStats() {
    if (!this.isReady()) return null;
    
    try {
      return await this.index.describeIndexStats();
    } catch (error) {
      console.error('Failed to get stats:', error);
      return null;
    }
  }
}

export default VectorStore;