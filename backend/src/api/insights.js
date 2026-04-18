// Insights API
// Endpoints for daily summaries and weekly patterns

import { DailySummarizer } from '../analysis/summarizer.js';
import { PatternDetector, RiskDetector } from '../analysis/patterns.js';

export class InsightsAPI {
  constructor(db, llmApiKey) {
    this.db = db;
    this.summarizer = llmApiKey ? new DailySummarizer(llmApiKey) : null;
    this.patternDetector = llmApiKey ? new PatternDetector(llmApiKey) : null;
    this.riskDetector = new RiskDetector();
  }

  /**
   * Generate daily summary
   */
  async generateDailySummary(userId, date = new Date()) {
    // Get entries for the day
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    
    const entries = await this.getUserEntries(userId, startOfDay, endOfDay);
    
    const thoughts = entries.filter(e => e.entry_type === 'thought');
    const events = entries.filter(e => e.entry_type === 'event');
    
    // Generate summary using LLM
    let summary = null;
    if (this.summarizer && thoughts.length > 0) {
      try {
        summary = await this.summarizer.summarize(thoughts, events);
      } catch (error) {
        console.error('Failed to generate summary:', error);
      }
    }
    
    // Fallback to statistical summary
    if (!summary) {
      summary = this.generateStatisticalSummary(thoughts, events);
    }
    
    // Store insight in database
    const insight = await this.storeInsight(userId, 'daily_summary', summary, {
      moodBreakdown: summary.mood_breakdown,
      averageEnergy: summary.average_energy,
      averageFocus: summary.average_focus,
      entryCount: entries.length
    });
    
    return insight;
  }

  /**
   * Generate weekly patterns
   */
  async generateWeeklyPatterns(userId, weekStart = new Date()) {
    // Get entries for the week
    const startOfWeek = new Date(weekStart);
    startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
    startOfWeek.setHours(0, 0, 0, 0);
    const endOfWeek = new Date(startOfWeek);
    endOfWeek.setDate(endOfWeek.getDate() + 7);
    
    const entries = await this.getUserEntries(userId, startOfWeek, endOfWeek);
    
    // Detect patterns using LLM
    let patterns = null;
    if (this.patternDetector && entries.length > 3) {
      try {
        patterns = await this.patternDetector.detectPatterns(entries);
      } catch (error) {
        console.error('Failed to detect patterns:', error);
      }
    }
    
    // Fallback to statistical patterns
    if (!patterns) {
      patterns = this.generateStatisticalPatterns(entries);
    }
    
    // Check for risk signals
    const riskSignals = this.riskDetector.detectRiskSignals(
      entries.filter(e => e.entry_type === 'thought'),
      userId
    );
    
    // Store insight
    const insight = await this.storeInsight(userId, 'weekly_pattern', patterns, {
      entryCount: entries.length,
      riskSignals: riskSignals.signals,
      recommendations: riskSignals.recommendations
    });
    
    return {
      ...insight,
      patterns,
      riskSignals
    };
  }

  /**
   * Get user entries for date range
   */
  async getUserEntries(userId, startDate, endDate) {
    const query = `
      SELECT e.*, tm.mood, tm.energy_level, tm.focus_level
      FROM entries e
      LEFT JOIN thought_metrics tm ON tm.entry_id = e.id
      WHERE e.user_id = $1 AND e.timestamp >= $2 AND e.timestamp <= $3
      ORDER BY e.timestamp ASC
    `;
    
    const result = await this.db.query(query, [userId, startDate, endDate]);
    return result.rows;
  }

  /**
   * Get stored insights for user
   */
  async getInsights(userId, options = {}) {
    const { type, limit = 10 } = options;
    
    let query = `
      SELECT * FROM insights
      WHERE user_id = $1
    `;
    
    const params = [userId];
    
    if (type) {
      query += ` AND insight_type = $2`;
      params.push(type);
    }
    
    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
    params.push(limit);
    
    const result = await this.db.query(query, params);
    return result.rows;
  }

  /**
   * Store insight in database
   */
  async storeInsight(userId, type, content, evidence = {}) {
    const query = `
      INSERT INTO insights (user_id, insight_type, content, evidence, headline, mood_breakdown, average_energy, average_focus)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    
    const result = await this.db.query(query, [
      userId,
      type,
      typeof content === 'string' ? content : JSON.stringify(content),
      JSON.stringify(evidence),
      content.headline || null,
      JSON.stringify(content.mood_breakdown || {}),
      content.average_energy || null,
      content.average_focus || null
    ]);
    
    return result.rows[0];
  }

  /**
   * Mark insight as read
   */
  async markAsRead(insightId, userId) {
    const query = `
      UPDATE insights
      SET is_read = TRUE
      WHERE id = $1 AND user_id = $2
      RETURNING *
    `;
    
    const result = await this.db.query(query, [insightId, userId]);
    return result.rows[0];
  }

  /**
   * Generate statistical summary (fallback)
   */
  generateStatisticalSummary(thoughts, events) {
    const moods = {};
    let totalEnergy = 0;
    let totalFocus = 0;
    let count = 0;
    
    for (const t of thoughts) {
      if (t.mood) {
        moods[t.mood] = (moods[t.mood] || 0) + 1;
      }
      if (t.energy_level) {
        totalEnergy += t.energy_level;
        count++;
      }
      if (t.focus_level) {
        totalFocus += t.focus_level;
      }
    }
    
    return {
      headline: thoughts.length > 0 
        ? `Today had ${thoughts.length} thoughts and ${events.length} events.`
        : 'No entries for today.',
      mood_breakdown: moods,
      average_energy: count > 0 ? parseFloat((totalEnergy / count).toFixed(1)) : 0,
      average_focus: count > 0 ? parseFloat((totalFocus / count).toFixed(1)) : 0,
      key_themes: [],
      insights: []
    };
  }

  /**
   * Generate statistical patterns (fallback)
   */
  generateStatisticalPatterns(entries) {
    // Simple pattern detection
    const byDay = {};
    
    for (const entry of entries) {
      const day = new Date(entry.timestamp).toLocaleDateString();
      if (!byDay[day]) {
        byDay[day] = { thoughts: 0, events: 0, energy: [], focus: [] };
      }
      
      if (entry.entry_type === 'thought') {
        byDay[day].thoughts++;
        if (entry.energy_level) byDay[day].energy.push(entry.energy_level);
        if (entry.focus_level) byDay[day].focus.push(entry.focus_level);
      } else {
        byDay[day].events++;
      }
    }
    
    // Find best/worst days
    let bestDay = null, worstDay = null;
    let bestAvg = 0, worstAvg = 10;
    
    for (const [day, data] of Object.entries(byDay)) {
      if (data.energy.length > 0) {
        const avg = data.energy.reduce((a, b) => a + b, 0) / data.energy.length;
        if (avg > bestAvg) { bestAvg = avg; bestDay = day; }
        if (avg < worstAvg) { worstAvg = avg; worstDay = day; }
      }
    }
    
    return {
      recurring_themes: [],
      routine_patterns: [],
      productivity_trends: { 
        best_day: bestDay, 
        worst_day: worstDay, 
        insight: bestDay && worstDay ? `Best on ${bestDay}, lowest on ${worstDay}` : '' 
      },
      emotional_patterns: [],
      schedule_conflicts: [],
      improvements: [],
      recommendations: []
    };
  }
}

export default InsightsAPI;