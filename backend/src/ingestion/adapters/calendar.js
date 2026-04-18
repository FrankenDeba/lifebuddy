// Google Calendar Adapter
// Handles webhook events and polling from Google Calendar API

import crypto from 'crypto';

export class CalendarAdapter {
  constructor(credentials = {}) {
    this.credentials = credentials;
    this.sourceType = 'google_calendar';
  }

  /**
   * Parse incoming webhook payload from Google Calendar
   * Google Calendar sends watch notifications - need to poll for changes
   */
  parseWebhook(body, headers) {
    // Google Calendar webhooks are channel notifications
    // We need to poll the calendar to get actual changes
    // This is handled by the sync endpoint
    return {
      requiresPolling: true,
      channelId: headers['x-goog-channel-id'],
      resourceId: headers['x-goog-resource-id'],
      resourceState: headers['x-goog-resource-state']
    };
  }

  /**
   * Normalize Google Calendar event to unified entry format
   */
  normalizeEvent(googleEvent, userId) {
    const startTime = googleEvent.start?.dateTime || googleEvent.start?.date;
    const endTime = googleEvent.end?.dateTime || googleEvent.end?.date;
    
    // Determine event type from summary
    const eventType = this.classifyEventType(googleEvent.summary, googleEvent.description);
    
    return {
      id: crypto.randomUUID(),
      userId,
      sourceType: this.sourceType,
      type: 'event',
      content: googleEvent.summary || 'Untitled Event',
      structured: {
        eventType,
        description: googleEvent.description || '',
        location: googleEvent.location || 'Unknown',
        attendees: (googleEvent.attendees || []).map(a => a.email),
        startTime,
        endTime,
        isAllDay: !!googleEvent.start?.date,
        recurrenceRule: googleEvent.recurrence?.[0] || null,
        htmlLink: googleEvent.htmlLink,
        calendarEventId: googleEvent.id
      },
      timestamp: new Date(startTime || new Date().toISOString()),
      sourceMetadata: {
        etag: googleEvent.etag,
        status: googleEvent.status,
        created: googleEvent.created,
        updated: googleEvent.updated
      },
      entryHash: this.generateHash(googleEvent)
    };
  }

  /**
   * Classify event type based on title and description
   */
  classifyEventType(summary, description) {
    const text = `${summary || ''} ${description || ''}`.toLowerCase();
    
    if (text.includes('deep work') || text.includes('focus') || text.includes('building')) {
      return 'focusTime';
    }
    if (text.includes('meeting') || text.includes('call') || text.includes('sync')) {
      return 'meeting';
    }
    if (text.includes('break') || text.includes('lunch') || text.includes('exercise')) {
      return 'break';
    }
    if (text.includes('journal') || text.includes('reflection') || text.includes('review')) {
      return 'reflection';
    }
    if (text.includes('workout') || text.includes('exercise') || text.includes('gym')) {
      return 'health';
    }
    
    return 'default';
  }

  /**
   * Generate deterministic hash for deduplication
   */
  generateHash(event) {
    const hashSource = `${event.id}:${event.etag}:${event.status}`;
    return crypto.createHash('sha256').update(hashSource).digest('hex').substring(0, 16);
  }

  /**
   * Poll calendar for events in a time range
   * Note: Requires Google Calendar API integration
   * This is a placeholder for the actual API call
   */
  async pollEvents(accessToken, calendarId = 'primary', timeMin, timeMax) {
    // Placeholder - actual implementation would call Google Calendar API:
    // GET https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events
    // Headers: Authorization: Bearer {accessToken}
    // Query: timeMin, timeMax, singleEvents=true, orderBy=startTime
    
    const events = []; // Would be populated from API response
    
    return events.map(e => this.normalizeEvent(e));
  }
}

export default CalendarAdapter;