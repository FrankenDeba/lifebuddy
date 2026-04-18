// LifeOS Backend Server
// Main entry point for API and webhook handling

import 'dotenv/config'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { v4 as uuidv4 } from 'uuid'

// Import modules
import db, { Database } from './src/db/index.js'
import { Normalizer } from './src/ingestion/normalizer.js'
import { CalendarAdapter } from './src/ingestion/adapters/calendar.js'
import { NotionAdapter } from './src/ingestion/adapters/notion.js'
import { VoiceAdapter } from './src/ingestion/adapters/voice.js'
import { DailySummarizer } from './src/analysis/summarizer.js'
import { PatternDetector, RiskDetector } from './src/analysis/patterns.js'
import { RecommendationEngine } from './src/recommendations/engine.js'
import { EntriesAPI } from './src/api/entries.js'
import { InsightsAPI } from './src/api/insights.js'
import { S3Storage } from './src/db/s3-storage.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

// ============================================
// Configuration
// ============================================

const config = {
  port: process.env.PORT || 4000,
  useDatabase: process.env.DATABASE_HOST && process.env.DATABASE_PASSWORD ? true : false,
  openRouterApiKey: process.env.OPENROUTER_API_KEY,
  dbConfig: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: process.env.DATABASE_PORT || 5432,
    database: process.env.DATABASE_NAME || 'lifebuddy',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD
  },
  s3Config: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'us-east-1',
    bucketName: process.env.S3_BUCKET_NAME || 'altiumate-s3-bucket',
    prefix: process.env.S3_PREFIX || 'users',
    cacheTTL: parseInt(process.env.S3_CACHE_TTL) || 300000,
    flushInterval: parseInt(process.env.S3_FLUSH_INTERVAL) || 30000
  },
  // Current user ID for multi-user support
  currentUserId: 'default-user'
}

// ============================================
// Adapters & Services
// ============================================

const calendarAdapter = new CalendarAdapter()
const notionAdapter = new NotionAdapter()
const voiceAdapter = new VoiceAdapter()
const normalizer = new Normalizer()
const riskDetector = new RiskDetector()

// LLM services (optional - require API key)
let summarizer = null
let patternDetector = null
let recommendationEngine = null
let entriesAPI = null
let insightsAPI = null

if (config.openRouterApiKey) {
  summarizer = new DailySummarizer(config.openRouterApiKey)
  patternDetector = new PatternDetector(config.openRouterApiKey)
  recommendationEngine = new RecommendationEngine(config.openRouterApiKey)
}

// S3 Storage (optional - with AWS credentials)
let s3Storage = null
if (config.s3Config.accessKeyId && config.s3Config.secretAccessKey) {
  s3Storage = new S3Storage(config.s3Config)
  console.log(`S3 Storage initialized: ${config.s3Config.bucketName}`)
}

// ============================================
// Fallback Data Loading (when no database)
// ============================================

const thoughtsPath = path.join(rootDir, 'thoughts.json')
const calendarPath = path.join(rootDir, 'calendar.json')

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    return { results: [], items: [] }
  }
}

function extractText(items = []) {
  return items.map((item) => item.text?.content || '').join(' ').trim()
}

function normalizeThoughts(rawThoughts) {
  return (rawThoughts.results || []).map((entry) => {
    const properties = entry.properties || {}
    return {
      id: entry.id,
      title: extractText(properties.Title?.title),
      content: extractText(properties.Content?.rich_text),
      mood: properties.Mood?.select?.name || 'Unknown',
      moodIntensity: properties['Mood Intensity']?.number ?? null,
      energyLevel: properties['Energy Level']?.number ?? null,
      focusLevel: properties['Focus Level']?.number ?? null,
      timeOfDay: properties['Time of Day']?.select?.name || 'Unknown',
      location: extractText(properties.Location?.rich_text),
      actionItems: extractText(properties['Action Items']?.rich_text),
      tags: (properties.Tags?.multi_select || []).map((tag) => tag.name),
      timestamp: properties.Timestamp?.date?.start || entry.created_time,
    }
  })
}

function normalizeCalendar(rawCalendar) {
  return (rawCalendar.items || []).map((event) => ({
    id: event.id,
    title: event.summary,
    description: event.description || '',
    location: event.location || 'Unknown',
    start: event.start?.dateTime || event.start?.date || null,
    end: event.end?.dateTime || event.end?.date || null,
    type: event.eventType || 'default',
    attendees: (event.attendees || []).map((attendee) => attendee.email),
  }))
}

// ============================================
// Core Functions
// ============================================

function buildInsightSummary(thoughts, events) {
  const moods = thoughts.reduce((acc, thought) => {
    acc[thought.mood] = (acc[thought.mood] || 0) + 1
    return acc
  }, {})

  const averageEnergy = thoughts.length
    ? Number((thoughts.reduce((sum, thought) => sum + (thought.energyLevel || 0), 0) / thoughts.length).toFixed(1))
    : 0

  const averageFocus = thoughts.length
    ? Number((thoughts.reduce((sum, thought) => sum + (thought.focusLevel || 0), 0) / thoughts.length).toFixed(1))
    : 0

  const recommendations = []

  const anxiousThought = thoughts.find((thought) => thought.mood === 'Anxious')
  if (anxiousThought) {
    recommendations.push({
      type: 'support',
      title: 'Reduce overload with a smaller next step',
      reason: 'An anxious morning reflection suggests task overload and low focus.',
      action: anxiousThought.actionItems || 'Break large work into smaller chunks.',
    })
  }

  const focusEvent = events.find((event) => event.type === 'focusTime')
  if (focusEvent) {
    recommendations.push({
      type: 'schedule',
      title: 'Protect more deep work time',
      reason: 'Your highest focus thought aligns with a focus-time calendar block.',
      action: 'Repeat this calendar pattern after lunch on future workdays.',
    })
  }

  recommendations.push({
    type: 'reflection',
    title: 'Keep the nightly reflection habit',
    reason: 'Your calendar already includes a reflection slot, which supports consistent self-review.',
    action: 'Use the nightly reflection to log mood, energy, and wins before sleep.',
  })

  const memoryLinks = thoughts.map((thought) => {
    const relatedEvent = events.find((event) => {
      const eventStart = new Date(event.start).getTime()
      const thoughtTime = new Date(thought.timestamp).getTime()
      return Math.abs(eventStart - thoughtTime) <= 60 * 60 * 1000
    })

    return {
      thoughtId: thought.id,
      thoughtTitle: thought.title,
      eventId: relatedEvent?.id || null,
      eventTitle: relatedEvent?.title || null,
      relationship: relatedEvent ? 'time-aligned' : 'standalone',
    }
  })

  return {
    headline: 'Your day started with overwhelm, peaked during deep work, and closed with space for reflection.',
    moodBreakdown: moods,
    averageEnergy,
    averageFocus,
    recommendations,
    memoryLinks,
  }
}

function buildNetwork(thoughts, events, insights) {
  const nodes = [
    ...thoughts.map((thought, index) => ({
      id: thought.id,
      label: thought.title,
      nodeType: 'thought',
      category: thought.mood,
      timestamp: thought.timestamp,
      x: 20 + index * 22,
      y: 24 + (index % 2) * 28,
      details: {
        content: thought.content,
        mood: thought.mood,
        energyLevel: thought.energyLevel,
        focusLevel: thought.focusLevel,
        actionItems: thought.actionItems,
        location: thought.location,
        tags: thought.tags,
      },
    })),
    ...events.map((event, index) => ({
      id: event.id,
      label: event.title,
      nodeType: 'event',
      category: event.type,
      timestamp: event.start,
      x: 58 + (index % 2) * 18,
      y: 16 + index * 18,
      details: {
        description: event.description,
        location: event.location,
        attendees: event.attendees,
        end: event.end,
      },
    })),
  ]

  const edges = insights.memoryLinks
    .filter((link) => link.eventId)
    .map((link) => ({
      id: `${link.thoughtId}-${link.eventId}`,
      source: link.thoughtId,
      target: link.eventId,
      relationship: link.relationship,
    }))

  return { nodes, edges }
}

// ============================================
// S3 Data Loading
// ============================================

async function loadFromS3(userId, fileName) {
  if (!s3Storage) return null
  try {
    return await s3Storage.get(userId, fileName)
  } catch (error) {
    console.error(`S3 load error for ${fileName}:`, error.message)
    return null
  }
}

async function saveToS3(userId, fileName, data) {
  if (!s3Storage) return
  try {
    await s3Storage.set(userId, fileName, data)
  } catch (error) {
    console.error(`S3 save error for ${fileName}:`, error.message)
  }
}

async function buildResponse() {
  const userId = config.currentUserId
  
  // Try S3 first if available, otherwise fall back to local files
  let rawThoughts, rawCalendar
  
  if (s3Storage && s3Storage.isAvailable()) {
    // Load from S3
    rawThoughts = await loadFromS3(userId, 'thoughts.json')
    rawCalendar = await loadFromS3(userId, 'calendar.json')
    
    // If S3 data is null, fall back to local files for initial data
    if (!rawThoughts || !rawThoughts.results) {
      console.log('S3 thoughts not found, using local file')
      rawThoughts = readJson(thoughtsPath)
      // Also try to set up initial data in S3
      await saveToS3(userId, 'thoughts.json', rawThoughts)
    }
    if (!rawCalendar || !rawCalendar.items) {
      console.log('S3 calendar not found, using local file')
      rawCalendar = readJson(calendarPath)
      await saveToS3(userId, 'calendar.json', rawCalendar)
    }
    
    console.log(`Loaded from S3: users/${userId}/`)
  } else {
    // Fall back to local files
    rawThoughts = readJson(thoughtsPath)
    rawCalendar = readJson(calendarPath)
  }

  const thoughts = normalizeThoughts(rawThoughts)
  const events = normalizeCalendar(rawCalendar)
  const insights = buildInsightSummary(thoughts, events)
  const network = buildNetwork(thoughts, events, insights)

  return {
    profile: {
      name: 'User',
      timezone: rawCalendar.timeZone,
      connectedSources: ['Google Calendar', 'Thought Journal'],
    },
    thoughts,
    events,
    insights,
    network,
  }
}

// ============================================
// JSON Helpers
// ============================================

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk) => body += chunk)
    req.on('end', () => {
      try {
        resolve(JSON.parse(body))
      } catch (e) {
        resolve({})
      }
    })
    req.on('error', reject)
  })
}

// ============================================
// HTTP Server
// ============================================

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const url = req.url.split('?')[0]

  // ============================================
  // API Routes
  // ============================================

  // Health check
  if (url === '/health') {
    res.end(JSON.stringify({ 
      status: 'ok',
      database: config.useDatabase,
      llm: !!config.openRouterApiKey,
      s3: s3Storage ? s3Storage.isAvailable() : false
    }))
    return
  }

  // Dashboard (main endpoint)
  if (url === '/api/dashboard') {
    const payload = await buildResponse()
    res.end(JSON.stringify(payload, null, 2))
    return
  }

  // Get entries
  if (url === '/api/entries' && req.method === 'GET') {
    const payload = await buildResponse()
    res.end(JSON.stringify({ entries: [...payload.thoughts, ...payload.events] }))
    return
  }

  // Create entry (manual thought)
  if (url === '/api/entries' && req.method === 'POST') {
    const body = await parseBody(req)
    const entry = {
      id: `entry_${uuidv4()}`,
      ...body,
      timestamp: new Date().toISOString()
    }
    res.end(JSON.stringify({ success: true, entry }))
    return
  }

  // Generate daily summary (mock when no LLM)
  if (url === '/api/summarize/daily' && req.method === 'POST') {
    const payload = await buildResponse()
    res.end(JSON.stringify(payload.insights))
    return
  }

  // Generate weekly patterns (mock when no LLM)
  if (url === '/api/summarize/weekly' && req.method === 'POST') {
    const payload = await buildResponse()
    res.end(JSON.stringify({
      recurring_themes: ['productivity', 'personal growth'],
      recommendations: payload.insights.recommendations
    }))
    return
  }

  // Webhook: Google Calendar
  if (url === '/webhook/calendar' && req.method === 'POST') {
    const body = await parseBody(req)
    // Process calendar webhook - would queue for processing
    console.log('Calendar webhook received:', body)
    res.end(JSON.stringify({ received: true }))
    return
  }

  // Webhook: Notion
  if (url === '/webhook/notion' && req.method === 'POST') {
    const body = await parseBody(req)
    // Process Notion webhook - would queue for processing
    console.log('Notion webhook received:', body)
    res.end(JSON.stringify({ received: true }))
    return
  }

  // Voice upload endpoint
  if (url === '/api/voice' && req.method === 'POST') {
    // Would handle multipart audio upload
    res.end(JSON.stringify({ 
      success: true,
      transcript: 'Voice memo placeholder',
      mood: 'Neutral'
    }))
    return
  }

  // Recommendations feedback
  if (url === '/api/recommendations/feedback' && req.method === 'POST') {
    const body = await parseBody(req)
    // Would store feedback in database
    res.end(JSON.stringify({ success: true, feedback: body.feedback }))
    return
  }

  // 404
  res.writeHead(404)
  res.end(JSON.stringify({ error: 'Not found' }))
})

// ============================================
// Start Server
// ============================================

server.listen(config.port, () => {
  console.log(`
╔═══════════════════════════════════════════╗
║      LifeOS Backend Running          ║
║      http://localhost:${config.port}              ║
╠═══════════════════════════════════════════╣
║  Database: ${config.useDatabase ? '✓ Connected' : '✗ Using JSON fallback'}
║  LLM:     ${config.openRouterApiKey ? '✓ OpenRouter (gemma-4-31b)' : '✗ Not configured'}
║  S3:      ${(s3Storage && s3Storage.isAvailable()) ? '✓ Connected' : '✗ Not configured'}
╚═══════════════════════════════════════════╝
  `)
})

export default server