-- LifeOS Database Schema
-- PostgreSQL with vector search support via Pinecone

-- ============================================
-- Core Tables
-- ============================================

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) UNIQUE,
    timezone VARCHAR(50) DEFAULT 'UTC',
    privacy_settings JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Source connections (Google Calendar, Notion, etc.)
CREATE TABLE source_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    source_type VARCHAR(50) NOT NULL, -- 'google_calendar', 'notion', 'voice', 'health'
    credentials JSONB, -- encrypted credentials
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'inactive', 'error'
    last_sync_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Entries table (unified, stores all types)
CREATE TABLE entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    source_connection_id UUID REFERENCES source_connections(id) ON DELETE SET NULL,
    entry_type VARCHAR(50) NOT NULL, -- 'thought', 'event', 'goal', 'habit', 'health'
    content TEXT NOT NULL,
    structured_data JSONB DEFAULT '{}',
    source_metadata JSONB DEFAULT '{}',
    entry_hash VARCHAR(64), -- for deduplication
    timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for efficient querying by user and time
CREATE INDEX idx_entries_user_timestamp ON entries(user_id, timestamp DESC);

-- Index for deduplication
CREATE INDEX idx_entries_hash ON entries(user_id, entry_hash) WHERE entry_hash IS NOT NULL;

-- ============================================
-- Thought-specific fields (extends entries)
-- ============================================

CREATE TABLE thought_metrics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,
    mood VARCHAR(50),
    mood_intensity INTEGER CHECK (mood_intensity >= 1 AND mood_intensity <= 10),
    energy_level INTEGER CHECK (energy_level >= 1 AND energy_level <= 10),
    focus_level INTEGER CHECK (focus_level >= 1 AND focus_level <= 10),
    location VARCHAR(255),
    time_of_day VARCHAR(20),
    tags TEXT[] DEFAULT '{}',
    action_items TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Event-specific fields (extends entries)
-- ============================================

CREATE TABLE event_details (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,
    calendar_event_id VARCHAR(255),
    event_type VARCHAR(50) DEFAULT 'default', -- 'default', 'focusTime', 'meeting'
    description TEXT,
    location VARCHAR(255),
    attendees TEXT[] DEFAULT '{}',
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    is_all_day BOOLEAN DEFAULT FALSE,
    recurrence_rule TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Insights and Recommendations
-- ============================================

CREATE TABLE insights (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    insight_type VARCHAR(50) NOT NULL, -- 'daily_summary', 'weekly_pattern', 'risk_signal'
    content TEXT NOT NULL,
    evidence JSONB DEFAULT '{}', -- supporting data
    headline VARCHAR(500),
    mood_breakdown JSONB DEFAULT '{}',
    average_energy DECIMAL(3,1),
    average_focus DECIMAL(3,1),
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_insights_user_created ON insights(user_id, created_at DESC);

CREATE TABLE recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    insight_id UUID REFERENCES insights(id) ON DELETE SET NULL,
    rec_type VARCHAR(50) NOT NULL, -- 'schedule', 'support', 'reflection', 'habit'
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    reason TEXT,
    action TEXT,
    status VARCHAR(20) DEFAULT 'pending', -- 'pending', 'approved', 'dismissed'
    feedback VARCHAR(20), -- 'up', 'down', NULL
    weight DECIMAL(3,2) DEFAULT 1.00,
    approved_at TIMESTAMP WITH TIME ZONE,
    dismissed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_recommendations_user_status ON recommendations(user_id, status);

-- ============================================
-- Memory Links (Relationships)
-- ============================================

CREATE TABLE memory_links (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    source_entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,
    target_entry_id UUID REFERENCES entries(id) ON DELETE CASCADE,
    relationship_type VARCHAR(50) NOT NULL, -- 'time_aligned', 'caused', 'related', 'supports'
    confidence DECIMAL(3,2) DEFAULT 1.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(source_entry_id, target_entry_id, relationship_type)
);

CREATE INDEX idx_memory_links_source ON memory_links(source_entry_id);
CREATE INDEX idx_memory_links_target ON memory_links(target_entry_id);

-- ============================================
-- Goals and Habits
-- ============================================

CREATE TABLE goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    target_date DATE,
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'completed', 'paused', 'cancelled'
    progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE habits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    frequency VARCHAR(20) DEFAULT 'daily', -- 'daily', 'weekly', 'custom'
    schedule JSONB DEFAULT '{}',
    streak_current INTEGER DEFAULT 0,
    streak_longest INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================
-- Health Signals (Future)
-- ============================================

CREATE TABLE health_signals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    signal_type VARCHAR(50) NOT NULL, -- 'sleep', 'activity', 'heart_rate'
    value DECIMAL(10,2) NOT NULL,
    unit VARCHAR(20),
    source VARCHAR(50), -- 'apple_health', 'google_fit'
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX idx_health_signals_user_recorded ON health_signals(user_id, recorded_at DESC);

-- ============================================
-- Helper Views
-- ============================================

-- View for dashboard: thoughts with metrics joined
CREATE VIEW v_thoughts_with_metrics AS
SELECT 
    e.id,
    e.user_id,
    e.content,
    e.timestamp,
    e.created_at,
    tm.mood,
    tm.mood_intensity,
    tm.energy_level,
    tm.focus_level,
    tm.location,
    tm.time_of_day,
    tm.tags,
    tm.action_items
FROM entries e
LEFT JOIN thought_metrics tm ON tm.entry_id = e.id
WHERE e.entry_type = 'thought';

-- View for events with details joined
CREATE VIEW v_events_with_details AS
SELECT 
    e.id,
    e.user_id,
    e.content AS title,
    e.timestamp,
    e.created_at,
    ed.calendar_event_id,
    ed.event_type,
    ed.description,
    ed.location,
    ed.attendees,
    ed.start_time,
    ed.end_time,
    ed.is_all_day
FROM entries e
LEFT JOIN event_details ed ON ed.entry_id = e.id
WHERE e.entry_type = 'event';

-- ============================================
-- Trigger Functions
-- ============================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for auto-update
CREATE TRIGGER users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER entries_updated_at BEFORE UPDATE ON entries
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER goals_updated_at BEFORE UPDATE ON goals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER habits_updated_at BEFORE UPDATE ON habits
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();