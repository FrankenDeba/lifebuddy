// S3 Storage Module
// Stores JSON files in S3 with user-ID partitioning and caching

import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

export class S3Storage {
  constructor(config = {}) {
    this.s3Client = null;
    this.bucketName = config.bucketName || 'altiumate-s3-bucket';
    this.region = config.region || 'us-east-1';
    this.prefix = config.prefix || 'users';
    
    // In-memory cache
    this.cache = new Map();
    this.cacheTTL = config.cacheTTL || 5 * 60 * 1000; // 5 minutes default
    
    // Write buffer
    this.writeBuffer = new Map();
    this.flushInterval = config.flushInterval || 30 * 1000; // 30 seconds default
    this.flushTimer = null;
    this.bufferingEnabled = false;
    
    // Fallback mode
    this.fallbackMode = false;
    this.memoryStore = new Map();
    
    // Initialize S3 client if config provided
    if (config.accessKeyId && config.secretAccessKey) {
      this.init(config);
    }
  }

  /**
   * Initialize S3 client
   */
  init(config) {
    this.s3Client = new S3Client({
      region: config.region || 'us-east-1',
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      }
    });
    
    this.bucketName = config.bucketName || this.bucketName;
    this.region = config.region || this.region;
    
    // Start flush timer
    this.startFlushTimer();
    
    console.log(`S3 Storage initialized: ${this.bucketName}`);
  }

  /**
   * Start periodic flush timer for buffered writes
   */
  startFlushTimer() {
    if (this.flushTimer) return;
    
    this.flushTimer = setInterval(() => {
      this.flushAll();
    }, this.flushInterval);
    
    this.bufferingEnabled = true;
  }

  /**
   * Stop flush timer
   */
  stopFlushTimer() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  /**
   * Get S3 key for a user's file
   */
  getKey(userId, fileName) {
    return `${this.prefix}/${userId}/${fileName}`;
  }

  /**
   * Get data from cache or S3
   */
  async get(userId, fileName, options = {}) {
    const key = this.getKey(userId, fileName);
    const now = Date.now();
    
    // Check cache first
    const cached = this.cache.get(key);
    if (cached && (now - cached.timestamp) < this.cacheTTL) {
      return cached.data;
    }
    
    // If in fallback mode, use memory store
    if (this.fallbackMode) {
      return this.memoryStore.get(key) || null;
    }
    
    // Try S3
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key
      });
      
      const response = await this.s3Client.send(command);
      
      if (!response.Body) {
        return null;
      }
      
      // Convert stream to string
      const bodyString = await this.streamToString(response.Body);
      const data = JSON.parse(bodyString);
      
      // Update cache
      this.cache.set(key, { data, timestamp: now });
      
      return data;
    } catch (error) {
      if (error.name === 'NoSuchKey') {
        // File doesn't exist yet - return null
        return null;
      }
      
      console.error(`S3 get error for ${key}:`, error.message);
      this.enableFallbackMode();
      return this.memoryStore.get(key) || null;
    }
  }

  /**
   * Set data to S3 (buffered)
   */
  async set(userId, fileName, data) {
    const key = this.getKey(userId, fileName);
    const now = Date.now();
    
    // Update memory store (for fallback)
    this.memoryStore.set(key, data);
    
    // Update cache
    this.cache.set(key, { data, timestamp: now });
    
    // If not buffering, write immediately
    if (!this.bufferingEnabled) {
      return this.setImmediate(userId, fileName, data);
    }
    
    // Add to write buffer
    if (!this.writeBuffer.has(userId)) {
      this.writeBuffer.set(userId, new Map());
    }
    this.writeBuffer.get(userId).set(fileName, data);
    
    return { success: true, buffered: true };
  }

  /**
   * Write data immediately to S3 (no buffering)
   */
  async setImmediate(userId, fileName, data) {
    if (this.fallbackMode) {
      // Just update memory store
      const key = this.getKey(userId, fileName);
      this.memoryStore.set(key, data);
      return { success: true, fallback: true };
    }
    
    const key = this.getKey(userId, fileName);
    
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: JSON.stringify(data, null, 2),
        ContentType: 'application/json'
      });
      
      await this.s3Client.send(command);
      
      return { success: true };
    } catch (error) {
      console.error(`S3 set error for ${key}:`, error.message);
      this.enableFallbackMode();
      return { success: true, fallback: true };
    }
  }

  /**
   * Flush all buffered writes
   */
  async flushAll() {
    if (this.writeBuffer.size === 0) return;
    
    const buffer = this.writeBuffer;
    this.writeBuffer = new Map();
    
    for (const [userId, files] of buffer) {
      for (const [fileName, data] of files) {
        try {
          await this.setImmediate(userId, fileName, data);
        } catch (error) {
          console.error(`Flush error for ${userId}/${fileName}:`, error.message);
        }
      }
    }
    
    console.log(`Flushed ${buffer.size} user(s) to S3`);
  }

  /**
   * Flush specific user's data
   */
  async flushUser(userId) {
    const userBuffer = this.writeBuffer.get(userId);
    if (!userBuffer) return;
    
    this.writeBuffer.delete(userId);
    
    for (const [fileName, data] of userBuffer) {
      await this.setImmediate(userId, fileName, data);
    }
  }

  /**
   * List all user IDs in bucket
   */
  async listUsers() {
    if (this.fallbackMode || !this.s3Client) {
      return [...new Set([...this.memoryStore.keys()].map(k => k.split('/')[1]))];
    }
    
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Delimiter: '/',
        Prefix: `${this.prefix}/`
      });
      
      const response = await this.s3Client.send(command);
      
      if (!response.CommonPrefixes) return [];
      
      return response.CommonPrefixes.map(p => 
        p.Prefix.replace(this.prefix, '').split('/').filter(Boolean)[0]
      );
    } catch (error) {
      console.error('List users error:', error.message);
      return [];
    }
  }

  /**
   * Enable fallback mode (memory only)
   */
  enableFallbackMode() {
    if (this.fallbackMode) return;
    
    this.fallbackMode = true;
    console.warn('S3 unavailable - using memory-only mode');
  }

  /**
   * Check if S3 is available
   */
  isAvailable() {
    return !this.fallbackMode && this.s3Client !== null;
  }

  /**
   * Convert stream to string
   */
  async streamToString(stream) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf-8');
  }

  /**
   * Shutdown - flush and close
   */
  async shutdown() {
    this.stopFlushTimer();
    await this.flushAll();
    console.log('S3 Storage shutdown complete');
  }
}

// Default instance
const s3Storage = new S3Storage();

export default s3Storage;