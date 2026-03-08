import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import * as mc from '../../utils/mcdata.js';

export class DamageLogger {
    constructor(agent) {
        this.agent = agent;
        this.botName = agent.name;
        this.log_fp = `./bots/${this.botName}/damage_log.json`;
        this.logs = [];
        this.max_logs = 50;

        // Damage accumulation threshold: only trigger learn when total unlearned damage >= threshold
        this.accumulatedDamage = 0;
        this.learnThreshold = 6; // ~3 hearts worth of damage before recommending reflex learning
        this.readyToLearn = false;

        // Kill tracking for confidence engine
        this.kills_count = 0;

        this.loadLogs();
    }

    loadLogs() {
        if (!existsSync(this.log_fp)) return;
        try {
            const data = JSON.parse(readFileSync(this.log_fp, 'utf8'));
            if (Array.isArray(data)) {
                // Legacy format: just an array of logs
                this.logs = data;
            } else if (data && typeof data === 'object') {
                // New format: { logs, accumulatedDamage }
                this.logs = Array.isArray(data.logs) ? data.logs : [];
                this.accumulatedDamage = typeof data.accumulatedDamage === 'number' ? data.accumulatedDamage : 0;
                if (this.accumulatedDamage >= this.learnThreshold && this.logs.length >= 3) {
                    this.readyToLearn = true;
                }
            }
        } catch (err) {
            console.warn('Failed to load damage logs:', err);
        }
    }

    saveLogs() {
        try {
            mkdirSync(`./bots/${this.botName}`, { recursive: true });
            const data = {
                logs: this.logs,
                accumulatedDamage: this.accumulatedDamage
            };
            writeFileSync(this.log_fp, JSON.stringify(data, null, 2), 'utf8');
        } catch (err) {
            console.warn('Failed to save damage logs:', err);
        }
    }

    startListening() {
        const bot = this.agent.bot;
        if (!bot) return;

        // NOTE: health listener is handled by agent.js unified listener.
        // agent.js calls this.recordDamageEvent(amount) directly.

        // Track when bot dies so we mark last log as fatal
        bot.on('death', () => {
            if (this.logs.length > 0) {
                this.logs[this.logs.length - 1].fatal = true;
                this.saveLogs();
            }
        });

        // Reset kills on respawn
        bot.on('spawn', () => {
            this.kills_count = 0;
        });

        // Count kills of hostile entities
        bot.on('entityDead', (entity) => {
            if (entity && mc.isHostile(entity)) {
                this.kills_count++;
            }
        });
    }

    recordDamageEvent(amount) {
        const bot = this.agent.bot;
        const pos = bot.entity.position;
        if (!pos) return;

        // Try to identify attacker if it's an entity nearby
        let attackerName = 'unknown';
        let attackerType = 'unknown';
        const entities = Object.values(bot.entities);
        let closestDist = Infinity;
        let closestAttacker = null;

        for (const entity of entities) {
            if (entity === bot.entity) continue;
            // Hostile mobs or players
            if (entity.type === 'hostile' || entity.type === 'player' || entity.type === 'mob') {
                const dist = entity.position.distanceTo(pos);
                if (dist < 6 && dist < closestDist) { // Reasonable melee range + some lag buffer
                    closestDist = dist;
                    closestAttacker = entity;
                }
            }
        }

        if (closestAttacker) {
            attackerName = closestAttacker.name || closestAttacker.username || 'unknown';
            attackerType = closestAttacker.type;
        } else if (bot.entity.isInWater) {
            attackerName = 'drowning';
            attackerType = 'environment';
        } else if (bot.entity.isInLava) {
            attackerName = 'lava';
            attackerType = 'environment';
        } else if (bot.entity.onGround === false && amount > 2) { // Fall damage heuristic
            attackerName = 'fall_damage';
            attackerType = 'environment';
        }

        const snapshot = {
            timestamp: new Date().toISOString(),
            damage: amount,
            health_after: bot.health,
            fatal: false,
            attacker: attackerName,
            attacker_type: attackerType,
            bot_action: this.agent.actions.currentActionLabel || 'idle',
            inventory: this._getTopItems(),
            position: {
                x: Math.round(pos.x * 10) / 10,
                y: Math.round(pos.y * 10) / 10,
                z: Math.round(pos.z * 10) / 10
            }
        };

        this.logs.push(snapshot);
        if (this.logs.length > this.max_logs) {
            this.logs.shift(); // Keep only last N logs
        }

        console.log(`[DamageLogger] Logged ${amount} damage from ${attackerName}. Remaining health: ${bot.health}`);

        // Track accumulated damage for learning threshold
        this.accumulatedDamage += amount;
        if (this.accumulatedDamage >= this.learnThreshold && this.logs.length >= 3) {
            this.readyToLearn = true;
            console.log(`[DamageLogger] Accumulated ${this.accumulatedDamage.toFixed(1)} damage (threshold: ${this.learnThreshold}). Ready to learn reflexes.`);
        }

        this.saveLogs();
    }

    _getTopItems() {
        const bot = this.agent.bot;
        if (!bot || !bot.inventory) return [];
        const items = bot.inventory.items().map(i => ({ name: i.name, count: i.count }));
        // Just take the first 5 unique items as a rough hint of what we carry (weapons, blocks, food)
        return items.slice(0, 5);
    }

    getRecentLogs() {
        return this.logs;
    }

    getDeathReplay() {
        if (this.logs.length === 0) return "No recent damage logs available.";

        // Get logs from the last 30 seconds
        const now = Date.now();
        const recentLogs = this.logs.filter(l => {
            const ts = Date.parse(l.timestamp);
            if (!Number.isFinite(ts)) {
                return false;
            }
            return now - ts <= 30000;
        });

        if (recentLogs.length === 0) return "No damage taken in the last 30 seconds.";

        let totalDamage = 0;
        const attackers = {};
        let finalAction = recentLogs[recentLogs.length - 1].bot_action;

        for (const log of recentLogs) {
            totalDamage += log.damage;
            const attacker = log.attacker;
            if (!attackers[attacker]) attackers[attacker] = 0;
            attackers[attacker] += log.damage;
        }

        const attackerSummary = Object.entries(attackers)
            .map(([name, dmg]) => `${name} (${dmg.toFixed(1)} HP)`)
            .join(', ');

        return `Death Replay (Last 30s): Took ${totalDamage.toFixed(1)} total damage from: ${attackerSummary}. Last action before dying: ${finalAction}.`;
    }

    clearLogs() {
        this.logs = [];
        this.accumulatedDamage = 0;
        this.readyToLearn = false;
        this.saveLogs();
    }

    getRecentKills() {
        return this.kills_count;
    }
}
