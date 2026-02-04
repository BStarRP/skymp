"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DatabaseManager = void 0;
const promise_1 = __importDefault(require("mysql2/promise"));
class DatabaseManager {
    connection = null;
    config;
    constructor(databaseSettings) {
        this.config = {
            host: databaseSettings.host,
            port: databaseSettings.port,
            user: databaseSettings.user,
            password: databaseSettings.password,
            database: databaseSettings.name,
            charset: 'utf8mb4',
            // MariaDB compatibility settings
            insecureAuth: true,
            supportBigNumbers: true,
            bigNumberStrings: true
        };
    }
    async initialize() {
        try {
            this.connection = await promise_1.default.createConnection(this.config);
            console.log('📁 Connected to MySQL/MariaDB database');
            await this.createTables();
        }
        catch (err) {
            console.error('Failed to connect to MySQL database:', err);
            throw err;
        }
    }
    async createTables() {
        if (!this.connection)
            throw new Error('Database not initialized');
        const queries = [
            `CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        discord_id VARCHAR(255) UNIQUE NOT NULL,
        discord_username VARCHAR(255) NOT NULL,
        discord_discriminator VARCHAR(10) NOT NULL,
        discord_avatar VARCHAR(255),
        master_api_id VARCHAR(255) UNIQUE NOT NULL,
        is_banned BOOLEAN DEFAULT FALSE,
        banned_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_discord_id (discord_id),
        INDEX idx_master_api_id (master_api_id)
      )`,
            `CREATE TABLE IF NOT EXISTS sessions (
        id VARCHAR(255) PRIMARY KEY,
        user_id INT NOT NULL,
        token VARCHAR(255) UNIQUE NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ip_address VARCHAR(45),
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        INDEX idx_token (token),
        INDEX idx_user_id (user_id)
      )`,
            `CREATE TABLE IF NOT EXISTS auth_states (
        state VARCHAR(255) PRIMARY KEY,
        discord_token TEXT,
        user_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
        INDEX idx_user_id (user_id),
        INDEX idx_expires_at (expires_at)
      )`
        ];
        for (const query of queries) {
            await this.connection.execute(query);
        }
        // Clean up expired entries on startup
        await this.cleanupExpiredEntries();
    }
    async run(query, params = []) {
        if (!this.connection)
            throw new Error('Database not initialized');
        const [result] = await this.connection.execute(query, params);
        return result;
    }
    async get(query, params = []) {
        if (!this.connection)
            throw new Error('Database not initialized');
        const [rows] = await this.connection.execute(query, params);
        const result = rows;
        return result.length > 0 ? result[0] : undefined;
    }
    async all(query, params = []) {
        if (!this.connection)
            throw new Error('Database not initialized');
        const [rows] = await this.connection.execute(query, params);
        return rows;
    }
    // User operations
    async createUser(userData) {
        const result = await this.run(`INSERT INTO users (discord_id, discord_username, discord_discriminator, discord_avatar, master_api_id, is_banned, banned_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?)`, [
            userData.discord_id,
            userData.discord_username,
            userData.discord_discriminator,
            userData.discord_avatar || null,
            userData.master_api_id,
            userData.is_banned ? 1 : 0,
            userData.banned_reason || null
        ]);
        return result.insertId;
    }
    async updateUser(userId, updates) {
        const fields = [];
        const values = [];
        Object.entries(updates).forEach(([key, value]) => {
            if (key !== 'id' && key !== 'created_at' && value !== undefined) {
                fields.push(`${key} = ?`);
                if (key === 'is_banned') {
                    values.push(value ? 1 : 0);
                }
                else {
                    values.push(value);
                }
            }
        });
        if (fields.length === 0)
            return;
        values.push(userId);
        await this.run(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, values);
    }
    async getUserByDiscordId(discordId) {
        return this.get('SELECT * FROM users WHERE discord_id = ?', [discordId]);
    }
    async getUserByMasterApiId(masterApiId) {
        return this.get('SELECT * FROM users WHERE master_api_id = ?', [masterApiId]);
    }
    async getUserById(userId) {
        return this.get('SELECT * FROM users WHERE id = ?', [userId]);
    }
    // Session operations
    async createSession(sessionData) {
        await this.run(`INSERT INTO sessions (id, user_id, token, expires_at, ip_address)
       VALUES (?, ?, ?, ?, ?)`, [
            sessionData.id,
            sessionData.user_id,
            sessionData.token,
            sessionData.expires_at,
            sessionData.ip_address || null
        ]);
    }
    async getSessionByToken(token) {
        return this.get('SELECT * FROM sessions WHERE token = ? AND expires_at > NOW()', [token]);
    }
    async deleteSession(sessionId) {
        await this.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
    }
    async deleteUserSessions(userId) {
        await this.run('DELETE FROM sessions WHERE user_id = ?', [userId]);
    }
    // Auth state operations
    async createAuthState(state, expiresAt) {
        await this.run('INSERT INTO auth_states (state, expires_at) VALUES (?, ?)', [state, expiresAt]);
    }
    async updateAuthState(state, updates) {
        const fields = [];
        const values = [];
        Object.entries(updates).forEach(([key, value]) => {
            if (key !== 'state' && key !== 'created_at' && value !== undefined) {
                fields.push(`${key} = ?`);
                values.push(value);
            }
        });
        if (fields.length === 0)
            return;
        values.push(state);
        await this.run(`UPDATE auth_states SET ${fields.join(', ')} WHERE state = ?`, values);
    }
    async getAuthState(state) {
        return this.get('SELECT * FROM auth_states WHERE state = ? AND expires_at > NOW()', [state]);
    }
    async deleteAuthState(state) {
        await this.run('DELETE FROM auth_states WHERE state = ?', [state]);
    }
    async cleanupExpiredEntries() {
        await this.run('DELETE FROM sessions WHERE expires_at <= NOW()');
        await this.run('DELETE FROM auth_states WHERE expires_at <= NOW()');
    }
}
exports.DatabaseManager = DatabaseManager;
