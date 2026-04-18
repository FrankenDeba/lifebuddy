// Normalizer Layer
// Transforms source-specific data into unified schema

import crypto from 'crypto';
import CalendarAdapter from './adapters/calendar.js';
import NotionAdapter from './adapters/notion.js';
import VoiceAdapter from './adapters/voice.js';

export class Normalizer {
  constructor() {
    this.adapters = {
      google_calendar: new CalendarAdapter(),
      notion: new NotionAdapter(),
      voice: new VoiceAdapter()
    };
  }

  /**
   * Get the appropriate adapter for a source type
   */
  getAdapter(sourceType) {
    const adapter = this.adapters[sourceType];
    if (!adapter) {
      throw new Error(`Unknown source type: ${sourceType}`);
    }
    return adapter;
  }

  /**
   * Main entry point: normalize any source data
   */
  normalize(sourceType, rawData, userId, options = {}) {
    const adapter = this.getAdapter(sourceType);
    
    let normalized;
    
    switch (sourceType) {
      case 'google_calendar':
        normalized = adapter.normalizeEvent(rawData, userId);
        break;
      case 'notion':
        normalized = adapter.normalizePage(rawData, userId);
        break;
      case 'voice':
        normalized = adapter.normalizeVoiceMemo(rawData, options, userId);
        break;
      default:
        normalized = this.normalizeGeneric(rawData, sourceType, userId);
    }
    
    // Apply common transformations
    return this.applyCommonTransforms(normalized, options);
  }

  /**
   * Normalize generic source data
   */
  normalizeGeneric(rawData, sourceType, userId) {
    return {
      id: crypto.randomUUID(),
      userId,
      sourceType,
      type: rawData.type || 'thought',
      content: rawData.content || rawData.text || 'Untitled',
      structured: rawData.structured || {},
      timestamp: new Date(rawData.timestamp || Date.now()),
      sourceMetadata: rawData.sourceMetadata || {},
      entryHash: this.generateContentHash(rawData)
    };
  }

  /**
   * Apply common transformations to all normalized entries
   */
  applyCommonTransforms(entry, options) {
    // Ensure required fields
    entry.id = entry.id || crypto.randomUUID();
    entry.timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date();
    
    // Apply privacy settings if provided
    if (options.privacySettings?.redactLocation) {
      entry.structured = { ...entry.structured, location: '[REDACTED]' };
    }
    
    // Apply content filters if provided
    if (options.filters) {
      entry = this.applyFilters(entry, options.filters);
    }
    
    return entry;
  }

  /**
   * Apply content filters
   */
  applyFilters(entry, filters) {
    // Filter sensitive terms
    if (filters.redactTerms) {
      for (const term of filters.redactTerms) {
        const regex = new RegExp(term, 'gi');
        entry.content = entry.content.replace(regex, '[REDACTED]');
      }
    }
    
    // Length limits
    if (filters.maxLength && entry.content.length > filters.maxLength) {
      entry.content = entry.content.substring(0, filters.maxLength) + '...';
    }
    
    return entry;
  }

  /**
   * Generate content hash for deduplication
   */
  generateContentHash(data) {
    const content = JSON.stringify(data);
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Check for duplicates within a time window
   * Returns true if duplicate exists
   */
  isDuplicate(newEntry, existingHashes, timeWindowMs = 3600000) {
    const newTime = newEntry.timestamp.getTime();
    
    for (const existing of existingHashes) {
      // Check if within time window
      if (Math.abs(newTime - existing.timestamp.getTime()) > timeWindowMs) {
        continue;
      }
      
      // Check hash match
      if (newEntry.entryHash === existing.entryHash) {
        return true;
      }
      
      // Check content similarity (simple approach)
      if (this.similarity(newEntry.content, existing.content) > 0.9) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Calculate content similarity (0-1)
   */
  similarity(a, b) {
    if (a === b) return 1;
    if (!a || !b) return 0;
    
    // Simple word-based similarity
    const wordsA = new Set(a.toLowerCase().split(/\s+/));
    const wordsB = new Set(b.toLowerCase().split(/\s+/));
    
    const intersection = [...wordsA].filter(w => wordsB.has(w)).length;
    const union = new Set([...wordsA, ...wordsB]).size;
    
    return union > 0 ? intersection / union : 0;
  }

  /**
   * Batch normalize multiple entries
   */
  batchNormalize(sourceType, rawDataArray, userId, options = {}) {
    const results = [];
    
    for (const raw of rawDataArray) {
      try {
        const normalized = this.normalize(sourceType, raw, userId, options);
        results.push({ success: true, data: normalized });
      } catch (error) {
        results.push({ success: false, error: error.message, raw });
      }
    }
    
    return results;
  }

  /**
   * Extract common fields from various source formats
   */
  extractCommonFields(rawData) {
    return {
      content: rawData.content || rawData.text || rawData.summary || '',
      timestamp: rawData.timestamp || rawData.created_at || rawData.createdTime || Date.now(),
      metadata: {
        id: rawData.id,
        sourceId: rawData.source_id || rawData.id,
        ...rawData.metadata
      }
    };
  }
}

export default Normalizer;