import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')

const thoughtsPath = path.join(rootDir, 'thoughts.json')
const calendarPath = path.join(rootDir, 'calendar.json')

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
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

function buildResponse() {
  const rawThoughts = readJson(thoughtsPath)
  const rawCalendar = readJson(calendarPath)

  const thoughts = normalizeThoughts(rawThoughts)
  const events = normalizeCalendar(rawCalendar)
  const insights = buildInsightSummary(thoughts, events)
  const network = buildNetwork(thoughts, events, insights)

  return {
    profile: {
      name: 'Debashis',
      timezone: rawCalendar.timeZone,
      connectedSources: ['Google Calendar', 'Thought Journal'],
    },
    thoughts,
    events,
    insights,
    network,
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/dashboard') {
    const payload = buildResponse()
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify(payload, null, 2))
    return
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
    res.end(JSON.stringify({ status: 'ok' }))
    return
  }

  res.writeHead(404, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(JSON.stringify({ error: 'Not found' }))
})

const PORT = 4000
server.listen(PORT, () => {
  console.log(`LifeBuddy backend running on http://localhost:${PORT}`)
})
