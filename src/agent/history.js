import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'fs';
import { NPCData } from './npc/data.js';
import settings from './settings.js';


export class History {
    constructor(agent) {
        this.agent = agent;
        this.name = agent.name;
        this.memory_fp = `./bots/${this.name}/memory.json`;
        this.full_history_fp = undefined;

        mkdirSync(`./bots/${this.name}/histories`, { recursive: true });

        this.turns = [];

        // Natural language memory as a summary of recent messages + previous memory
        this.memory = '';

        // Pin the first user/system message so it never gets summarized away
        this.pinnedMessage = null;

        // Maximum number of messages to keep in context before saving chunk to memory
        this.max_messages = settings.max_messages;

        // Number of messages to remove from current history and save into memory
        this.summary_chunk_size = 10;
        // chunking reduces expensive calls to promptMemSaving and appendFullHistory
        // and improves the quality of the memory summary

        // Soft character budget for memory — if exceeded, AI re-summarizes instead of truncating
        this.memory_char_budget = 4000;

        // Circuit breaker: max re-summarization attempts to prevent infinite API loops
        this.max_resummarize_attempts = 2;
    }

    getHistory() { // expects an Examples object
        return JSON.parse(JSON.stringify(this.turns));
    }

    async summarizeMemories(turns) {
        console.log("Storing memories...");
        this.memory = await this.agent.prompter.promptMemSaving(turns);

        // Circuit breaker: attempt re-summarization up to max_resummarize_attempts times
        let attempts = 0;
        while (this.memory.length > this.memory_char_budget && attempts < this.max_resummarize_attempts) {
            attempts++;
            console.log(`Memory too long (${this.memory.length} chars), re-summarization attempt ${attempts}/${this.max_resummarize_attempts}...`);
            const compressPrompt = [
                { role: 'system', content: this.memory }
            ];
            try {
                // Add delay to prevent API rate limiting
                await new Promise(resolve => setTimeout(resolve, 1500 * attempts));

                const compressed = await this.agent.prompter.promptMemSaving(compressPrompt);
                if (compressed && compressed.length > 0 && compressed.length < this.memory.length) {
                    this.memory = compressed;
                    console.log(`Memory re-compressed to ${this.memory.length} chars.`);
                } else {
                    console.log('Re-summarization did not reduce length, stopping.');
                    break;
                }
            } catch (err) {
                console.error('Failed to re-summarize memory:', err.message);
                break; // Circuit breaker: stop on error, do NOT truncate
            }
        }
        if (this.memory.length > this.memory_char_budget) {
            console.warn(`Memory still exceeds budget after ${attempts} attempts (${this.memory.length} chars). Applying safe line-based truncation to save tokens.`);
            // Giữ lại 70% memory phía sau, nhưng cắt theo từng dòng để tránh rác JSON/Code
            const keepLength = Math.floor(this.memory_char_budget * 0.7);
            const tailText = this.memory.substring(this.memory.length - keepLength);
            const firstNewlineIndex = tailText.indexOf('\n');
            if (firstNewlineIndex !== -1 && firstNewlineIndex < tailText.length - 1) {
                this.memory = "...[TRUNCATED_MEMORY]\n" + tailText.substring(firstNewlineIndex + 1);
            } else {
                this.memory = "...[TRUNCATED_MEMORY] " + tailText; // Fallback nếu không có newline
            }
            console.log(`Memory safely truncated to: ${this.memory.length} chars.`);
        }

        console.log("Memory updated to: ", this.memory);
    }

    async appendFullHistory(to_store) {
        if (this.full_history_fp === undefined) {
            const string_timestamp = new Date().toLocaleString().replace(/[/:]/g, '-').replace(/ /g, '').replace(/,/g, '_');
            this.full_history_fp = `./bots/${this.name}/histories/${string_timestamp}.json`;
            writeFileSync(this.full_history_fp, '[]', 'utf8');
        }
        try {
            const data = readFileSync(this.full_history_fp, 'utf8');
            let full_history = JSON.parse(data);
            full_history.push(...to_store);
            writeFileSync(this.full_history_fp, JSON.stringify(full_history, null, 4), 'utf8');
        } catch (err) {
            console.error(`Error reading ${this.name}'s full history file: ${err.message}`);
        }
    }

    async add(name, content) {
        let role = 'assistant';
        if (name === 'system') {
            role = 'system';
        }
        else if (name !== this.name) {
            role = 'user';
            content = `${name}: ${content}`;
        }
        this.turns.push({ role, content });

        // Pin the first user message as the original objective, or if it's the very first system message meant as an objective
        if (!this.pinnedMessage && (role === 'user' || (role === 'system' && this.turns.length <= 1 && content.length > 20))) {
            let pinnedContent = content;
            if (pinnedContent.length > 500) {
                pinnedContent = pinnedContent.substring(0, 500) + '... [Truncated for Context Limit]';
            }
            this.pinnedMessage = { role, content: pinnedContent };
        }

        if (this.turns.length >= this.max_messages) {
            let chunk = this.turns.splice(0, this.summary_chunk_size);
            while (this.turns.length > 0 && this.turns[0].role === 'assistant')
                chunk.push(this.turns.shift()); // remove until turns starts with system/user message

            // Re-insert pinned message at the front if it was removed in the chunk
            if (this.pinnedMessage && !this.turns.some(t => t.content === this.pinnedMessage.content)) {
                this.turns.unshift(this.pinnedMessage);
            }

            await this.summarizeMemories(chunk);
            await this.appendFullHistory(chunk);
        }
    }

    async save() {
        try {
            const data = {
                memory: this.memory,
                turns: this.turns,
                self_prompting_state: this.agent.self_prompter.state,
                self_prompt: this.agent.self_prompter.isStopped() ? null : this.agent.self_prompter.prompt,
                taskStart: this.agent.task.taskStartTime,
                last_sender: this.agent.last_sender,
                pinnedMessage: this.pinnedMessage
            };
            writeFileSync(this.memory_fp, JSON.stringify(data, null, 2));
            console.log('Saved memory to:', this.memory_fp);
        } catch (error) {
            console.error('Failed to save history:', error);
            throw error;
        }
    }

    load() {
        try {
            if (!existsSync(this.memory_fp)) {
                console.log('No memory file found.');
                return null;
            }
            const data = JSON.parse(readFileSync(this.memory_fp, 'utf8'));
            this.memory = data.memory || '';
            this.turns = data.turns || [];
            this.pinnedMessage = data.pinnedMessage || null;
            console.log('Loaded memory:', this.memory);
            return data;
        } catch (error) {
            console.error('Failed to load history:', error);
            throw error;
        }
    }

    clear() {
        this.turns = [];
        this.memory = '';
        this.pinnedMessage = null;
    }
}