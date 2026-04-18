// Pattern Detector
// LLM-powered weekly pattern detection and analysis using OpenRouter (google/gemma-4-31b-it)

export class PatternDetector {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.model = 'google/gemma-4-31b-it:free';
    this.maxTokens = 1536;
    this.apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
  }

  /**
   * Detect patterns across a week's worth of data
   */
  async detectPatterns(entries, options = {}) {
    const prompt = this.buildPatternPrompt(entries, options);
    
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
    return this.parsePatternResponse(data.choices?.[0]?.message?.content || '');
  }

  /**
   * Build prompt for pattern detection
   */
  buildPatternPrompt(entries, options) {
    // Group entries by day
    const byDay = this.groupByDay(entries);
    
    const dailySummaries = Object.entries(byDay).map(([day, dayEntries]) => {
      const thoughts = dayEntries.filter(e => e.entryType === 'thought');
      const events = dayEntries.filter(e => e.entryType === 'event');
      
      return `
## ${day}
Thoughts: ${thoughts.length}
Events: ${events.length}
Moods: ${[...new Set(thoughts.map(t => t.mood))].join(', ')}
Average Energy: ${this.avg(thoughts.map(t => t.energyLevel))}
Average Focus: ${this.avg(thoughts.map(t => t.focusLevel))}
`;
    }).join('\n');

    return `
You are a personal AI assistant analyzing patterns in the user's week.
Based on the following weekly data, identify meaningful patterns.

## Weekly Data
${dailySummaries}

## Instructions
Identify:
1. Recurring themes/topics across the week
2. Routine patterns (consistent times, activities)
3. Productivity trends (best/worst days)
4. Emotional patterns (mood swings, triggers)
5. Conflicts or issues in schedule
6. Positive improvements since last week

Respond in JSON format:
{
  "recurring_themes": [...],
  "routine_patterns": [...],
  "productivity_trends": {"best_day": "...", "worst_day": "...", "insight": "..."},
  "emotional_patterns": [...],
  "schedule_conflicts": [...],
  "improvements": [...],
  "recommendations": [...]
}
`;
  }

  /**
   * Group entries by day
   */
  groupByDay(entries) {
    const byDay = {};
    
    for (const entry of entries) {
      const date = new Date(entry.timestamp).toLocaleDateString('en-US', { 
        weekday: 'long', month: 'short', day: 'numeric' 
      });
      
      if (!byDay[date]) {
        byDay[date] = [];
      }
      byDay[date].push(entry);
    }
    
    return byDay;
  }

  /**
   * Calculate average of numbers
   */
  avg(numbers) {
    const valid = numbers.filter(n => typeof n === 'number');
    if (valid.length === 0) return 0;
    return valid.reduce((a, b) => a + b, 0) / valid.length;
  }

  /**
   * Parse pattern response
   */
  parsePatternResponse(text) {
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      return this.getDefaultPatterns();
    } catch (error) {
      console.error('Failed to parse pattern response:', error);
      return this.getDefaultPatterns();
    }
  }

  /**
   * Default patterns for fallback
   */
  getDefaultPatterns() {
    return {
      recurring_themes: [],
      routine_patterns: [],
      productivity_trends: { best_day: null, worst_day: null, insight: '' },
      emotional_patterns: [],
      schedule_conflicts: [],
      improvements: [],
      recommendations: []
    };
  }
}

// Risk Signal Detector
// Analyzes entries for concerning patterns (non-diagnostic)

export class RiskDetector {
  constructor() {
    // Keywords that may indicate user is struggling
    // Framed as "supportive signals", not "diagnoses"
    this.riskKeywords = [
      { pattern: /burnout|exhausted|overwhelmed/i, type: 'overwork', weight: 0.7 },
      { pattern: /can'?t go on|give up|hopeless/i, type: 'despair', weight: 0.9 },
      { pattern: /isolated|alone|no one|i have no friends/i, type: 'isolation', weight: 0.6 },
      { pattern: /worst|terrible|failure|nothing works/i, type: 'negative_self_talk', weight: 0.5 },
      { pattern: /panic|anxiety|can'?t breathe|heart racing/i, type: 'anxiety', weight: 0.6 },
      { pattern: /sleep problems|can'?t sleep|insomnia/i, type: 'sleep_issues', weight: 0.5 },
      { pattern: /hurt|myself|self.?harm/i, type: 'self_harm', weight: 1.0 }
    ];
    
    // Supportive resource messages
    this.supportiveMessages = {
      overwork: 'It sounds like you have a lot on your plate. Consider taking a small break or breaking tasks into smaller steps.',
      despair: 'Things can feel overwhelming. Consider reaching out to someone you trust or a support resource.',
      isolation: 'Connection matters. Consider reaching out to a friend or family member, or joining a community.',
      negative_self_talk: 'Be gentle with yourself. Consider writing down three things that went well today.',
      anxiety: 'When feelings of anxiety arise, try deep breathing or grounding exercises.',
      sleep_issues: 'Good sleep is important. Consider a consistent bedtime routine.',
      self_harm: 'Your well-being matters. Please consider reaching out to a trusted person or crisis line.'
    };
  }

  /**
   * Detect risk signals in entries
   */
  detectRiskSignals(entries, userId) {
    const signals = [];
    
    for (const entry of entries) {
      const content = entry.content || '';
      
      for (const { pattern, type, weight } of this.riskKeywords) {
        if (pattern.test(content)) {
          // Check for recent occurrence (multiple signals in past week)
          const signal = this.createSignal(entry, type, weight);
          
          if (!signals.find(s => s.type === type)) {
            signals.push(signal);
          }
        }
      }
    }
    
    return {
      signals,
      recommendations: signals.map(s => ({
        type: 'support',
        title: 'Supportive Check-in',
        content: this.supportiveMessages[s.type] || 'Consider taking a moment to check in with yourself.',
        reason: `Detected ${s.type} signal in recent entries.`,
        action: 'Reach out to a trusted contact or try a self-care activity.',
        isCrisis: s.weight >= 1.0
      }))
    };
  }

  /**
   * Create a signal object
   */
  createSignal(entry, type, weight) {
    return {
      type,
      weight,
      entryId: entry.id,
      timestamp: entry.timestamp,
      content: entry.content
    };
  }

  /**
   * Check if any signals require crisis resources
   */
  hasCrisisSignal(signals) {
    return signals.some(s => s.weight >= 1.0);
  }
}

export default PatternDetector;