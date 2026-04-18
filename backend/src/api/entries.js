// Entries API
// CRUD endpoints for entries

import { Normalizer } from '../ingestion/normalizer.js';

export class EntriesAPI {
  constructor(db, normalizer) {
    this.db = db;
    this.normalizer = normalizer || new Normalizer();
  }

  /**
   * Get all entries for a user
   */
  async getEntries(userId, options = {}) {
    const { type, limit = 50, offset = 0, startDate, endDate } = options;
    
    let query = `
      SELECT e.*, tm.mood, tm.mood_intensity, tm.energy_level, tm.focus_level,
             tm.location as thought_location, tm.time_of_day, tm.tags, tm.action_items,
             ed.event_type, ed.description as event_description, ed.location as event_location,
             ed.start_time, ed.end_time, ed.attendees
      FROM entries e
      LEFT JOIN thought_metrics tm ON tm.entry_id = e.id
      LEFT JOIN event_details ed ON ed.entry_id = e.id
      WHERE e.user_id = $1
    `;
    
    const params = [userId];
    let paramIndex = 2;
    
    if (type) {
      query += ` AND e.entry_type = $${paramIndex++}`;
      params.push(type);
    }
    
    if (startDate) {
      query += ` AND e.timestamp >= $${paramIndex++}`;
      params.push(startDate);
    }
    
    if (endDate) {
      query += ` AND e.timestamp <= $${paramIndex++}`;
      params.push(endDate);
    }
    
    query += ` ORDER BY e.timestamp DESC`;
    query += ` LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);
    
    const result = await this.db.query(query, params);
    return result.rows;
  }

  /**
   * Get a single entry by ID
   */
  async getEntry(entryId, userId) {
    const query = `
      SELECT e.*, tm.mood, tm.mood_intensity, tm.energy_level, tm.focus_level,
             tm.location as thought_location, tm.time_of_day, tm.tags, tm.action_items,
             ed.event_type, ed.description as event_description, ed.location as event_location,
             ed.start_time, ed.end_time, ed.attendees
      FROM entries e
      LEFT JOIN thought_metrics tm ON tm.entry_id = e.id
      LEFT JOIN event_details ed ON ed.entry_id = e.id
      WHERE e.id = $1 AND e.user_id = $2
    `;
    
    const result = await this.db.query(query, [entryId, userId]);
    return result.rows[0] || null;
  }

  /**
   * Create a new entry
   */
  async createEntry(userId, sourceType, rawData, options = {}) {
    // Normalize the entry
    const normalized = this.normalizer.normalize(sourceType, rawData, userId, options);
    
    // Insert entry
    const entryQuery = `
      INSERT INTO entries (user_id, source_connection_id, entry_type, content, structured_data, source_metadata, entry_hash, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    
    const entryResult = await this.db.query(entryQuery, [
      userId,
      normalized.sourceConnectionId || null,
      normalized.type,
      normalized.content,
      JSON.stringify(normalized.structured),
      JSON.stringify(normalized.sourceMetadata),
      normalized.entryHash,
      normalized.timestamp
    ]);
    
    const entry = entryResult.rows[0];
    
    // Insert type-specific data
    if (normalized.type === 'thought' && normalized.structured) {
      await this.insertThoughtMetrics(entry.id, normalized.structured);
    } else if (normalized.type === 'event' && normalized.structured) {
      await this.insertEventDetails(entry.id, normalized.structured);
    }
    
    return entry;
  }

  /**
   * Insert thought-specific metrics
   */
  async insertThoughtMetrics(entryId, structured) {
    const query = `
      INSERT INTO thought_metrics (entry_id, mood, mood_intensity, energy_level, focus_level, location, time_of_day, tags, action_items)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `;
    
    await this.db.query(query, [
      entryId,
      structured.mood || null,
      structured.moodIntensity || null,
      structured.energyLevel || null,
      structured.focusLevel || null,
      structured.location || null,
      structured.timeOfDay || null,
      structured.tags || [],
      structured.actionItems || null
    ]);
  }

  /**
   * Insert event-specific details
   */
  async insertEventDetails(entryId, structured) {
    const query = `
      INSERT INTO event_details (entry_id, event_type, description, location, attendees, start_time, end_time)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
    `;
    
    await this.db.query(query, [
      entryId,
      structured.eventType || 'default',
      structured.description || null,
      structured.location || null,
      structured.attendees || [],
      structured.startTime || null,
      structured.endTime || null
    ]);
  }

  /**
   * Delete an entry
   */
  async deleteEntry(entryId, userId) {
    const query = `DELETE FROM entries WHERE id = $1 AND user_id = $2 RETURNING id`;
    const result = await this.db.query(query, [entryId, userId]);
    return result.rows[0] !== undefined;
  }

  /**
   * Get entries for date range
   */
  async getEntriesForRange(userId, startDate, endDate) {
    return this.getEntries(userId, { startDate, endDate });
  }

  /**
   * Get today's entries
   */
  async getTodayEntries(userId) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    return this.getEntriesForRange(userId, today, tomorrow);
  }
}

export default EntriesAPI;