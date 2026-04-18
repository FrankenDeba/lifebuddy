// Notion Adapter
// Handles webhook events from Notion (via Notion API or webhook integration)

import crypto from 'crypto';

export class NotionAdapter {
  constructor(credentials = {}) {
    this.credentials = credentials;
    this.sourceType = 'notion';
  }

  /**
   * Parse incoming webhook from Notion
   * Notion sends page created/updated/deleted events
   */
  parseWebhook(body) {
    const { event: notionEvent, source } = body;
    
    if (!notionEvent) {
      throw new Error('Invalid Notion webhook payload');
    }

    return {
      pageId: notionEvent?.parent?.page_id || notionEvent?.id,
      action: notionEvent?.action || 'unknown',
      object: notionEvent?.object,
      properties: notionEvent?.properties,
      lastEditedTime: notionEvent?.last_edited_time
    };
  }

  /**
   * Normalize Notion page to Thought entry
   * Maps Notion's complex property structure to unified format
   */
  normalizePage(notionPage, userId) {
    const properties = notionPage.properties || {};
    
    return {
      id: crypto.randomUUID(),
      userId,
      sourceType: this.sourceType,
      type: 'thought',
      content: this.extractTitle(properties),
      structured: {
        mood: this.extractSelect(properties, 'Mood'),
        moodIntensity: this.extractNumber(properties, 'Mood Intensity'),
        energyLevel: this.extractNumber(properties, 'Energy Level'),
        focusLevel: this.extractNumber(properties, 'Focus Level'),
        location: this.extractRichText(properties, 'Location'),
        actionItems: this.extractRichText(properties, 'Action Items'),
        tags: this.extractMultiSelect(properties, 'Tags'),
        timeOfDay: this.extractSelect(properties, 'Time of Day'),
        timestamp: this.extractDate(properties, 'Timestamp')
      },
      timestamp: this.extractTimestamp(properties),
      sourceMetadata: {
        notionPageId: notionPage.id,
        createdTime: notionPage.created_time,
        lastEditedTime: notionPage.last_edited_time,
        archived: notionPage.archived,
        icon: notionPage.icon,
        cover: notionPage.cover,
        parent: this.sanitizeParent(notionPage.parent)
      },
      entryHash: this.generateHash(notionPage)
    };
  }

  /**
   * Extract title from Notion title property
   */
  extractTitle(properties) {
    const titleProp = properties['Title'] || properties['title'];
    if (!titleProp?.title?.length) return 'Untitled';
    
    return titleProp.title
      .map(t => t.plain_text || t.text?.content || '')
      .join('')
      .trim() || 'Untitled';
  }

  /**
   * Extract select property value
   */
  extractSelect(properties, key) {
    const prop = properties[key];
    if (!prop?.select) return null;
    return prop.select.name || null;
  }

  /**
   * Extract number property value
   */
  extractNumber(properties, key) {
    const prop = properties[key];
    return prop?.number ?? null;
  }

  /**
   * Extract rich_text property value
   */
  extractRichText(properties, key) {
    const prop = properties[key];
    if (!prop?.rich_text?.length) return '';
    
    return prop.rich_text
      .map(t => t.plain_text || t.text?.content || '')
      .join('')
      .trim();
  }

  /**
   * Extract multi_select property as array
   */
  extractMultiSelect(properties, key) {
    const prop = properties[key];
    if (!prop?.multi_select?.length) return [];
    
    return prop.multi_select.map(item => item.name);
  }

  /**
   * Extract date property
   */
  extractDate(properties, key) {
    const prop = properties[key];
    return prop?.date?.start ?? null;
  }

  /**
   * Determine timestamp for the entry
   */
  extractTimestamp(properties) {
    const dateProp = properties['Timestamp'] || properties['timestamp'];
    const dateValue = dateProp?.date?.start;
    
    if (dateValue) {
      return new Date(dateValue);
    }
    
    // Fall back to created_time from page metadata
    return new Date();
  }

  /**
   * Sanitize parent reference
   */
  sanitizeParent(parent) {
    if (!parent) return null;
    
    // Remove sensitive parent info
    return {
      type: parent.type,
      workspace_id: parent.workspace_id,
      page_id: parent.page_id,
      database_id: parent.database_id
    };
  }

  /**
   * Generate deterministic hash for deduplication
   */
  generateHash(page) {
    const hashSource = `${page.id}:${page.last_edited_time}`;
    return crypto.createHash('sha256').update(hashSource).digest('hex').substring(0, 16);
  }

  /**
   * Process a webhook payload
   */
  processWebhook(body, userId) {
    const webhook = this.parseWebhook(body);
    
    if (webhook.action === 'page.deleted') {
      return {
        action: 'delete',
        pageId: webhook.pageId
      };
    }

    // For created/updated, we need full page data from Notion API
    // The webhook only gives us the ID, we need to fetch the page
    return {
      action: 'upsert',
      pageId: webhook.pageId,
      normalized: null // Would be populated after fetching page
    };
  }
}

export default NotionAdapter;