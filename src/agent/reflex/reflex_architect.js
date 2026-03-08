import { validateReflexCode } from './validator.js';
import * as fs from 'fs';
import settings from '../settings.js';

export class ReflexArchitect {
    constructor(agent) {
        this.agent = agent;
        this.botName = agent.name;
        this.reflexes_dir = `./bots/${this.botName}/reflexes`;
        fs.mkdirSync(this.reflexes_dir, { recursive: true });
    }

    /**
     * Called when the bot accumulates enough damage or when user explicitly triggers `!learnReflexes`.
     * Reads the damage logs, prompts AI to propose a unified JS reflex handler,
     * validates it, and saves it to disk.
     */
    async learnFromDamage() {
        const logs = this.agent.damage_logger.getRecentLogs();
        if (!logs || logs.length < 3) {
            return 'Not enough damage logs to learn a reliable reflex. Keep playing (or dying) to gather more data.';
        }

        // Check accumulated damage threshold before spending API tokens
        if (!this.agent.damage_logger.readyToLearn) {
            return `Not enough accumulated damage to justify learning. Current: ${this.agent.damage_logger.accumulatedDamage.toFixed(1)} HP, threshold: ${this.agent.damage_logger.learnThreshold} HP.`;
        }

        // Group similar incidents (e.g. lots of "lava" or "zombie" damage)
        const { report: summary, topThreat } = this._summarizeLogs(logs);

        console.log(`[ReflexArchitect] Learning from damage. Summary: ${summary}`);

        const systemPrompt = `You are a survival instinct module for a Minecraft bot named ${this.botName}.
The bot has repeatedly taken damage from specific scenarios detailed below.
Write a javascript function that will execute EVERY TIME the bot takes damage to prevent further harm.

You have the following parameters available:
- bot: The mineflayer bot object
- attacker: The entity name/type that caused damage (e.g. "zombie", "lava", "fall_damage", "drowning")
- amount: Health lost
- skills: The agent's skills module (skills.defendSelf, skills.moveAway, skills.goToSurface)
- world: The agent's world knowledge

IMPORTANT:
1. ONLY return the JS code block \`\`\`js ... \`\`\`
2. Write ONE overarching handler that uses \`if (attacker === '...')\` statements to handle the top threats.
3. Be EXTREMELY brief and fast. Use simple synchronous checks or await fast skills.
4. DO NOT do anything if the attacker is unknown or the threat isn't severe yet (e.g. only react to drowning if health is actually low).

Example structure:
\`\`\`js
if (attacker === 'zombie' && amount > 2) {
    bot.chat("A zombie is hurting me!");
    await skills.defendSelf(bot, 10);
} else if (attacker === 'lava') {
    await skills.goToSurface(bot);
}
\`\`\`
`.trim();

        const userPrompt = `Here is a summary of recent damage events:\n\n${summary}\n\nWrite the Javascript reflex handler.`;

        const messages = [{ role: 'user', content: userPrompt }];

        let response = '';
        try {
            response = await this.agent.prompter.chat_model.sendRequest(messages, systemPrompt);
        } catch (err) {
            return `Failed to generate reflex: model error ${err.message}`;
        }

        const jsCode = this._extractJsBlock(response);
        if (!jsCode) {
            return 'Failed to automatically learn: model did not output a valid JS codeblock.';
        }

        // Keep validation optional for maximum freedom in sandbox environments.
        if (!settings.allow_insecure_reflexes) {
            const validation = validateReflexCode(jsCode);
            if (!validation.valid) {
                console.error('[ReflexArchitect] Generated code failed security checks:', validation.reason);
                console.error('Code was:\n', jsCode);
                return `Failed to learn reflex: generated code failed security validation (${validation.reason}).`;
            }
        }

        // Formatting standard file
        const finalFileContent = `
// Auto-generated Reflex Handler
// Learned from recent damage logs

export async function handleReflex(bot, attacker, amount, skills, world, Vec3) {
    try {
${jsCode.split('\n').map(l => '        ' + l).join('\n')}
    } catch (err) {
        console.error('[Reflex] Handler crashed:', err.message);
    }
}
        `.trim() + '\n';

        const safeThreatName = topThreat.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase() || 'general';
        const fp = `${this.reflexes_dir}/reflex_${safeThreatName}.js`;
        try {
            fs.writeFileSync(fp, finalFileContent, 'utf8');
            this.agent.damage_logger.clearLogs(); // Clear logs once learned so we don't over-fit

            // Reload the reflex immediately
            this.agent.reflex_loader.loadReflexes();

            return `Successfully learned a new survival reflex! Saved to ${fp}.`;
        } catch (err) {
            return `Failed to save new reflex securely: ${err.message}`;
        }
    }

    _summarizeLogs(logs) {
        const counts = {};
        let fatalCount = 0;

        for (const log of logs) {
            const key = log.attacker; // Use base attacker for naming
            const displayKey = log.attacker + (log.attacker_type !== 'unknown' ? ` (${log.attacker_type})` : '');
            if (!counts[key]) counts[key] = { displayKey, hits: 0, total_damage: 0, actions: new Set() };
            counts[key].hits += 1;
            counts[key].total_damage += log.damage;
            counts[key].actions.add(log.bot_action);
            if (log.fatal) fatalCount++;
        }

        let report = `Total incidents observed: ${logs.length}\nTotal fatal incidents: ${fatalCount}\n\nTop Threats:\n`;
        // Composite score: 60% total damage weight + 40% hit frequency weight
        // This prevents high-single-hit sources (lava) from always winning over
        // frequent low-damage threats (zombies hitting 20 times).
        const maxDamage = Math.max(...Object.values(counts).map(s => s.total_damage), 1);
        const maxHits = Math.max(...Object.values(counts).map(s => s.hits), 1);
        const sorted = Object.entries(counts).sort((a, b) => {
            const scoreA = (a[1].total_damage / maxDamage) * 0.6 + (a[1].hits / maxHits) * 0.4;
            const scoreB = (b[1].total_damage / maxDamage) * 0.6 + (b[1].hits / maxHits) * 0.4;
            return scoreB - scoreA;
        });
        const topThreat = sorted.length > 0 ? sorted[0][0] : 'general';

        for (const [threat, stats] of sorted) {
            const acts = Array.from(stats.actions).join(', ');
            report += `- ${stats.displayKey}: Hit ${stats.hits} times for ${stats.total_damage.toFixed(1)} total damage. (Happened while bot was doing: [${acts}])\n`;
        }
        return { report, topThreat };
    }

    _extractJsBlock(text) {
        // Bug #2 Fix: Properly escape \s and \S in the regex and use non-capturing group for language specifier.
        const match = text.match(/```(?:js|javascript)?([\s\S]*?)```/);
        if (match && match[1]) {
            return match[1].trim();
        }
        // Fallback: if there are no backticks, only accept if it looks strongly like code
        // Fix 3.5: Require function/async keywords to reduce false positives from prose
        if (!text.includes('```') && text.includes('if (') && text.includes('}') && (text.includes('await ') || text.includes('bot.'))) {
            return text.trim();
        }
        return null; // Failed to parse
    }
}
