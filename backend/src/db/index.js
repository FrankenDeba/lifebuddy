// Database connection module
// PostgreSQL connection management

import pg from 'pg';

const { Pool } = pg;

export class Database {
  constructor(config = {}) {
    this.pool = null;
    this.config = config;
  }

  /**
   * Initialize connection pool
   */
  init(config) {
    this.config = config || this.config;
    
    this.pool = new Pool({
      host: this.config.host || 'localhost',
      port: this.config.port || 5432,
      database: this.config.database || 'lifebuddy',
      user: this.config.user || 'postgres',
      password: this.config.password,
      max: this.config.maxConnections || 10,
      idleTimeoutMillis: this.config.idleTimeoutMillis || 30000,
      connectionTimeoutMillis: this.config.connectionTimeoutMillis || 2000
    });
    
    // Test connection
    this.pool.on('error', (err) => {
      console.error('Unexpected database error:', err);
    });
    
    return this.pool;
  }

  /**
   * Get pool
   */
  getPool() {
    return this.pool;
  }

  /**
   * Check connection
   */
  async checkConnection() {
    if (!this.pool) {
      return { connected: false, error: 'Pool not initialized' };
    }
    
    try {
      const result = await this.pool.query('SELECT now(), version()');
      return { connected: true, result: result };
    } catch (error) {
      return { connected: false, error: error.message };
    }
  }

  /**
   * Execute query
   */
  async query(text, params) {
    if (!this.pool) {
      throw new Error('Database not initialized');
    }
    return this.pool.query(text, params);
  }

  /**
   * Close pool
   */
  async close() {
    if (this.pool) {
      await this.pool.end();
    }
  }
}

// Default singleton instance
const db = new Database();

export default db;