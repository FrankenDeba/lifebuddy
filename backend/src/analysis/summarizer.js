// Daily Summarizer
// LLM-powered daily summary generation using OpenRouter (google/gemma-4-31b-it)

export class DailySummarizer {
  constructor(apiKey) {
    this.apiKey = apiKey;
    this.model = 'google/gemma-4-31b-it:free';
    this.maxTokens = 1024;
    this.apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
  }

  /**
   * Generate daily summary from thoughts and events
   */
  async summarize(thoughts, events, options = {}) {
    const prompt = this.buildDailyPrompt(thoughts, events, options);
    
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
    return this.parseSummaryResponse(data.choices?.[0]?.message?.content || '');
  }

  /**
   * Build prompt for daily summarization
   */
  buildDailyPrompt(thoughts, events, options) {
    const thoughtsSummary = thoughts.map(t => `
- Mood: ${t.mood || 'Unknown'}
- Energy: ${t.energyLevel || 'N/A'}/10
- Focus: ${t.focusLevel || 'N/A'}/10
- Content: ${t.content}
- Time: ${t.timestamp}
- Tags: ${(t.tags || []).join(', ')}
`).join('\n');

    const eventsSummary = events.map(e => `
- Title: ${e.title}
- Type: ${e.eventType || 'default'}
- Start: ${e.startTime}
- End: ${e.endTime}
`).join('\n');

    return `
You are a personal AI assistant helping generate a daily summary.
Based on the following thoughts and calendar events from today, generate a brief summary.

## Thoughts/Journal Entries
${thoughtsSummary}

## Calendar Events
${eventsSummary}

## Instructions
1. Generate a one-sentence headline summarizing the day
2. Provide mood breakdown (count of each mood)
3. Calculate average energy and focus levels
4. Keep it concise and supportive in tone

Respond in JSON format:
{
  "headline": "...",
  "mood_breakdown": {"Happy": 2, "Anxious": 1, ...},
  "average_energy": 7.5,
  "average_focus": 6.2,
  "key_themes": [...],
  "insights": [...]
}
`;
  }

  /**
   * Parse LLM response into structured summary
   */
  parseSummaryResponse(text) {
    try {
      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      
      // Fallback: parse manually
      return {
        headline: this.extractField(text, 'headline'),
        mood_breakdown: {},
        average_energy: 0,
        average_focus: 0,
        key_themes: [],
        insights: []
      };
    } catch (error) {
      console.error('Failed to parse summary response:', error);
      return this.getDefaultSummary();
    }
  }

  /**
   * Extract field from text
   */
  extractField(text, field) {
    const match = text.match(new RegExp(`${field}["']?:\\s*["']?([^"'\n]+)`, 'i'));
    return match ? match[1].trim() : '';
  }

  /**
   * Default summary for fallback
   */
  getDefaultSummary() {
    return {
      headline: 'Today was a productive day.',
      mood_breakdown: {},
      average_energy: 0,
      average_focus: 0,
      key_themes: [],
      insights: []
    };
  }
}

export default DailySummarizer;