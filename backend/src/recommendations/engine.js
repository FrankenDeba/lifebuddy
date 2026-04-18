// Recommendation Engine
// LLM-powered, database-backed recommendations with feedback learning using OpenRouter

export class RecommendationEngine {
  constructor(apiKey, dbPool = null) {
    this.apiKey = apiKey;
    this.model = 'google/gemma-4-31b-it:free';
    this.maxTokens = 1024;
    this.apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    this.dbPool = dbPool; // PostgreSQL pool for feedback storage
  }

  /**
   * Generate recommendations based on insights
   */
  async generate(insight, options = {}) {
    const weights = await this.getRecommendationWeights(options.userId);
    const prompt = this.buildRecommendationPrompt(insight, weights);
    
    const response = await fetch(this.apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': 'https://lifebuddy.app',
        'X-Title': 'LifeOS'
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API error: ${error}`);
    }
    
    const data = await response.json();
    const recommendations = this.parseRecommendations(data.choices?.[0]?.message?.content || '');
    
    // Apply learned weights
    return this.applyWeights(recommendations, weights);
  }

  /**
   * Build prompt for recommendation generation
   */
  buildRecommendationPrompt(insight, weights) {
    // Build context from previous feedback
    const feedbackContext = Object.entries(weights)
      .filter(([_, w]) => w < 1.0)
      .map(([type, weight]) => `- Lower priority for ${type} recommendations (user feedback)`)
      .join('\n');
    
    return `
You are a personal AI assistant generating actionable recommendations.
Based on the following insight, suggest helpful next steps.

## Insight
${insight.content || JSON.stringify(insight)}

## User Context (learned from feedback)
${feedbackContext || 'No previous feedback yet.'}

## Instructions
Generate 2-4 recommendations that are:
1. Actionable and specific
2. Non-judgmental and supportive
3. Aligned with user's goals

Each recommendation should include:
- type: 'schedule', 'support', 'reflection', or 'habit'
- title: brief title
- content: description
- reason: why this is helpful
- action: suggested next step

Respond in JSON format:
{
  "recommendations": [
    {"type": "...", "title": "...", "content": "...", "reason": "...", "action": "..."}
  ]
}
`;
  }

  /**
   * Parse recommendations from LLM response
   */
  parseRecommendations(text) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed.recommendations || [];
      }
      return [];
    } catch (error) {
      console.error('Failed to parse recommendations:', error);
      return [];
    }
  }

  /**
   * Apply learned weights to recommendations
   */
  applyWeights(recommendations, weights) {
    return recommendations.map(rec => ({
      ...rec,
      defaultWeight: weights[rec.type] || 1.0,
      weight: weights[rec.type] || 1.0
    }));
  }

  /**
   * Get recommendation weights from database
   */
  async getRecommendationWeights(userId) {
    if (!this.dbPool || !userId) {
      return this.getDefaultWeights();
    }
    
    try {
      const query = `
        SELECT rec_type, AVG(CASE 
          WHEN feedback = 'up' THEN 1.2
          WHEN feedback = 'down' THEN 0.6
          ELSE 1.0
        END) as weight
        FROM recommendations
        WHERE user_id = $1 AND feedback IS NOT NULL
        GROUP BY rec_type
      `;
      
      const result = await this.dbPool.query(query, [userId]);
      
      const weights = this.getDefaultWeights();
      for (const row of result.rows) {
        weights[row.rec_type] = parseFloat(row.weight);
      }
      
      return weights;
    } catch (error) {
      console.error('Failed to get weights:', error);
      return this.getDefaultWeights();
    }
  }

  /**
   * Default weights for new recommendations
   */
  getDefaultWeights() {
    return {
      schedule: 1.0,
      support: 1.0,
      reflection: 1.0,
      habit: 1.0
    };
  }

  /**
   * Store user feedback on a recommendation
   */
  async storeFeedback(recommendationId, feedback) {
    if (!this.dbPool) return;
    
    try {
      const query = `
        UPDATE recommendations
        SET feedback = $1,
            weight = CASE
              WHEN $1 = 'up' THEN weight * 1.2
              WHEN $1 = 'down' THEN weight * 0.7
              ELSE weight
            END
        WHERE id = $2
      `;
      
      await this.dbPool.query(query, [feedback, recommendationId]);
    } catch (error) {
      console.error('Failed to store feedback:', error);
    }
  }

  /**
   * Approve a recommendation for action
   */
  async approveRecommendation(recommendationId) {
    if (!this.dbPool) return false;
    
    try {
      const query = `
        UPDATE recommendations
        SET status = 'approved',
            approved_at = NOW()
        WHERE id = $1
      `;
      
      await this.dbPool.query(query, [recommendationId]);
      return true;
    } catch (error) {
      console.error('Failed to approve recommendation:', error);
      return false;
    }
  }

  /**
   * Dismiss a recommendation
   */
  async dismissRecommendation(recommendationId) {
    if (!this.dbPool) return false;
    
    try {
      const query = `
        UPDATE recommendations
        SET status = 'dismissed',
            dismissed_at = NOW()
        WHERE id = $1
      `;
      
      await this.dbPool.query(query, [recommendationId]);
      return true;
    } catch (error) {
      console.error('Failed to dismiss recommendation:', error);
      return false;
    }
  }

  /**
   * Generate context-aware recommendations based on time/location
   */
  async generateContextual(entry, timeOfDay, location) {
    const contextHint = this.buildContextHint(timeOfDay, location);
    
    // For now, generate basic recommendations
    // Full implementation would pass context to LLM
    return this.generate(entry, { contextHint });
  }

  /**
   * Build context hint string
   */
  buildContextHint(timeOfDay, location) {
    const parts = [];
    if (timeOfDay) parts.push(`Time: ${timeOfDay}`);
    if (location) parts.push(`Location: ${location}`);
    return parts.length > 0 ? parts.join(', ') : '';
  }
}

export default RecommendationEngine;