# LifeOS Data Pipeline - Implementation Plan

## Architecture Overview

```
Sources (Calendar, Notion, Voice)
    ↓ Event-driven webhooks
Event Bus (in-memory or Redis)
    ↓
Source Adapters → Normalizer → Unified Schema
    ↓
Graph DB (entities) + Vector Store (semantic search)
    ↓
Analysis Engine (LLM-powered) → Insights + Patterns
    ↓
Recommendation Engine → User-approved Actions
    ↓
Feedback Loop → Database-backed learning
```

---

## Phase 1: Core MVP

### 1.1 Data Model

| Entity | Description |
|--------|------------|
| `User` | id, name, timezone, privacy_settings |
| `SourceConnection` | user_id, source_type, credentials, status |
| `Entry` | id, user_id, source_id, type, content, timestamp, metadata |
| `Thought` | extends Entry: mood, energy, focus, location |
| `Event` | extends Entry: calendar data |
| `Insight` | id, user_id, type, content, evidence, created_at |
| `Recommendation` | id, user_id, insight_id, content, status, feedback, weight |
| `MemoryLink` | source_id, target_id, relationship_type |

### 1.2 Ingestion Service

**Source Adapters:**
- `CalendarAdapter`: Google Calendar webhook → normalize → emit Event entities
- `NotionAdapter`: Notion webhook → normalize → emit Thought entities
- `VoiceAdapter`: Audio upload endpoint → transcription → emit Thought entities

**Event Flow:**
1. Source sends webhook/polling trigger
2. Adapter normalizes to `NormalizedEntry` schema
3. Deduplication check (hash-based, 1-hour window)
4. Store to Graph DB + Vector index
5. Emit event to analysis queue

**Schema - NormalizedEntry:**
```typescript
interface NormalizedEntry {
  id: string;
  userId: string;
  sourceType: 'calendar' | 'notion' | 'voice' | 'manual';
  type: 'thought' | 'event' | 'goal' | 'habit' | 'health';
  content: string;
  structured: Record<string, any>;
  timestamp: Date;
  sourceMetadata: Record<string, any>;
  hash: string;
}
```

### 1.3 Analysis Engine

**Daily Summarization:**
- Query entries from past 24 hours
- LLM prompt: summarize mood trends, energy patterns, key events
- Output: headline + mood breakdown + average scores

**Weekly Pattern Detection:**
- Query entries from past 7 days
- LLM prompt: identify recurring topics, routine conflicts, productivity signals
- Output: themes[] + insights[] + recommendations[]

**Risk Signal Detection:**
- Keyword matching (burnout, isolation, crisis language)
- Statistical outliers (mood/energy drop > 2 std)
- Output: flagged insights with "supportive suggestion" framing

### 1.4 Recommendation Engine

**Generation:**
- LLM generates suggestions based on insights
- Conditions mapped to recommendation types

**Feedback Loop:**
- User thumbs up/down stored in `Recommendation` table
- Weight adjustment per recommendation type
- Future generations consider learned weights

**Approval Flow:**
- All recommendations shown as "pending"
- User approves → action scheduled
- User dismisses → no action

---

## Phase 2: Enriched Memory

### 2.1 Voice Transcription
- Add `/api/voice` upload endpoint
- Integrate speech-to-text service
- Store transcript as Thought entry

### 2.2 Graph Visualization
- Entities already in Graph DB
- Frontend queries network endpoints
- Force-directed layout (existing in App.jsx works)

### 2.3 Improved Recommendations
- Context-aware suggestions (time, location, past patterns)
- A/B testing framework for recommendations

---

## Phase 3: Wellness Intelligence

### 3.1 Health Integrations
- Apple Health / Google Fit adapters
- HealthSignal entity + sync

### 3.2 Anomaly Detection
- Time-series anomaly detection for mood/energy
- Alert thresholds configurable by user

### 3.3 Personalized Coaching
- User preference learning
- Contextual nudges (time-of-day, location-aware)

---

## Implementation Order

1. **Database schema** → Define entities in SQL/ORM
2. **Source adapters** → Calendar, Notion webhooks
3. **Normalizer layer** → Unified entry transformation
4. **Analysis endpoints** → Daily/weekly LLM calls
5. **Recommendation API** → Generate + feedback storage
6. **Frontend integration** → Connect to new APIs
7. **Voice upload** → Phase 2
8. **Health sync** → Phase 3

---

## Key Files to Create/Modify

| File | Action |
|------|--------|
| `backend/src/db/schema.sql` | Create |
| `backend/src/ingestion/adapters/` | Create |
| `backend/src/ingestion/normalizer.ts` | Create |
| `backend/src/analysis/summarizer.ts` | Create |
| `backend/src/analysis/patterns.ts` | Create |
| `backend/src/recommendations/engine.ts` | Create |
| `backend/src/api/entries.ts` | Create |
| `backend/src/api/insights.ts` | Create |
| `backend/server.js` | Modify |

---

## Decisions Needed

1. **LLM provider**: OpenAI, Anthropic, or local?
2. **Graph DB**: Neo4j, or PostgreSQL with graph extension?
3. **Vector store**: Pinecone, Weaviate, or local embeddings?
4. **Event bus**: In-memory (MVP) or Redis (production)?