import { io } from 'socket.io-client';
import convoManager from './conversation.js';
import { setSettings } from './settings.js';
import { getFullState } from './library/full_state.js';

// agent's individual connection to the mindserver
// always connect to localhost

class MindServerProxy {
    constructor() {
        if (MindServerProxy.instance) {
            return MindServerProxy.instance;
        }
        
        this.socket = null;
        this.connected = false;
        this.agents = [];
        this.heldResourceLocks = new Map();
        MindServerProxy.instance = this;
    }

    async connect(name, port) {
        if (this.connected) return;
        
        this.name = name;
        this.socket = io(`http://localhost:${port}`);

        await new Promise((resolve, reject) => {
            this.socket.on('connect', resolve);
            this.socket.on('connect_error', (err) => {
                console.error('Connection failed:', err);
                reject(err);
            });
        });

        this.connected = true;
        console.log(name, 'connected to MindServer');

        this.socket.on('disconnect', () => {
            console.log('Disconnected from MindServer');
            this.connected = false;
            this.heldResourceLocks.clear();
            if (this.agent) {
                this.agent.cleanKill('Disconnected from MindServer. Killing agent process.');
            }
        });

        this.socket.on('chat-message', (agentName, json) => {
            convoManager.receiveFromBot(agentName, json);
        });

        this.socket.on('agents-status', (agents) => {
            this.agents = agents;
            convoManager.updateAgents(agents);
            if (this.agent?.task) {
                console.log(this.agent.name, 'updating available agents');
                this.agent.task.updateAvailableAgents(agents);
            }
        });

        this.socket.on('restart-agent', (agentName) => {
            console.log(`Restarting agent: ${agentName}`);
            this.agent.cleanKill();
        });
		
        this.socket.on('send-message', (data) => {
            try {
                this.agent.respondFunc(data.from, data.message);
            } catch (error) {
                console.error('Error: ', JSON.stringify(error, Object.getOwnPropertyNames(error)));
            }
        });

        this.socket.on('get-full-state', (callback) => {
            try {
                const state = getFullState(this.agent);
                callback(state);
            } catch (error) {
                console.error('Error getting full state:', error);
                callback(null);
            }
        });

        // Request settings and wait for response
        await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Settings request timed out after 5 seconds'));
            }, 5000);

            this.socket.emit('get-settings', name, (response) => {
                clearTimeout(timeout);
                if (response.error) {
                    return reject(new Error(response.error));
                }
                setSettings(response.settings);
                this.socket.emit('connect-agent-process', name);
                resolve();
            });
        });
    }

    setAgent(agent) {
        this.agent = agent;
    }

    getAgents() {
        return this.agents;
    }

    getNumOtherAgents() {
        return this.agents.length - 1;
    }

    login() {
        this.socket.emit('login-agent', this.agent.name);
    }

    shutdown() {
        this.releaseAllResourceLocks().catch(err => {
            console.warn('Failed to release resource locks during shutdown:', err?.message || String(err));
        });
        this.socket.emit('shutdown');
    }

    getSocket() {
        return this.socket;
    }

    async _emitWithAck(eventName, ...args) {
        if (!this.socket || !this.connected) {
            return { ok: false, error: 'not_connected' };
        }
        return await new Promise(resolve => {
            let settled = false;
            const timeout = setTimeout(() => {
                if (!settled) {
                    settled = true;
                    resolve({ ok: false, error: 'timeout' });
                }
            }, 5000);
            this.socket.emit(eventName, ...args, (response) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timeout);
                resolve(response || { ok: false, error: 'empty_response' });
            });
        });
    }

    async acquireResourceLock(resourceKey, options = {}) {
        const key = (resourceKey || '').toString().trim();
        if (!key) {
            return { acquired: false, message: 'Resource key is required.' };
        }
        const ttlMs = Number.isFinite(options.ttlMs) ? Math.max(1000, Math.floor(options.ttlMs)) : 120000;
        const retryMs = Number.isFinite(options.retryMs) ? Math.max(100, Math.floor(options.retryMs)) : 500;
        const maxWaitMs = Number.isFinite(options.maxWaitMs) ? Math.max(0, Math.floor(options.maxWaitMs)) : 10000;

        if (!this.socket || !this.connected) {
            const token = `local-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
            this.heldResourceLocks.set(key, token);
            return {
                acquired: true,
                resource_key: key,
                token,
                local_fallback: true,
                message: `MindServer unavailable; granted local lock for ${key}.`
            };
        }

        const startedAt = Date.now();
        let lastOwner = null;
        let lastMessage = '';
        while (Date.now() - startedAt <= maxWaitMs) {
            const response = await this._emitWithAck('acquire-resource-lock', this.name, key, ttlMs);
            if (response?.ok) {
                this.heldResourceLocks.set(key, response.token);
                return {
                    acquired: true,
                    resource_key: key,
                    token: response.token,
                    owner: response.owner || this.name,
                    expires_at: response.expires_at || null,
                    local_fallback: false
                };
            }
            lastOwner = response?.owner || lastOwner;
            lastMessage = response?.error || lastMessage || 'lock_busy';
            const serverRetry = Number.isFinite(response?.retry_after_ms) ? Math.max(100, Math.floor(response.retry_after_ms)) : retryMs;
            const waitMs = Math.min(serverRetry, retryMs);
            if (Date.now() - startedAt + waitMs > maxWaitMs) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, waitMs));
        }

        return {
            acquired: false,
            resource_key: key,
            owner: lastOwner,
            message: `Lock ${key} is busy${lastOwner ? ` (owner: ${lastOwner})` : ''}. ${lastMessage || ''}`.trim()
        };
    }

    async releaseResourceLock(resourceKey, token = null) {
        const key = (resourceKey || '').toString().trim();
        if (!key) {
            return { released: false, message: 'Resource key is required.' };
        }
        const localToken = token || this.heldResourceLocks.get(key) || null;
        if (!this.socket || !this.connected) {
            this.heldResourceLocks.delete(key);
            return { released: true, resource_key: key, local_fallback: true };
        }
        const response = await this._emitWithAck('release-resource-lock', this.name, key, localToken);
        if (response?.ok) {
            this.heldResourceLocks.delete(key);
            return { released: true, resource_key: key, local_fallback: false };
        }
        return {
            released: false,
            resource_key: key,
            message: response?.error || 'release_failed'
        };
    }

    async releaseAllResourceLocks() {
        const keys = [...this.heldResourceLocks.keys()];
        for (const key of keys) {
            await this.releaseResourceLock(key, this.heldResourceLocks.get(key));
        }
    }
}

// Create and export a singleton instance
export const serverProxy = new MindServerProxy();

// for chatting with other bots
export function sendBotChatToServer(agentName, json) {
    serverProxy.getSocket().emit('chat-message', agentName, json);
}

// for sending general output to server for display
export function sendOutputToServer(agentName, message) {
    serverProxy.getSocket().emit('bot-output', agentName, message);
}
