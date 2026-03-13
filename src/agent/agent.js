import { History } from './history.js';
import { Coder } from './coder.js';
import { VisionInterpreter } from './vision/vision_interpreter.js';
import { Prompter } from '../models/prompter.js';
import { initModes } from './modes.js';
import { initBot } from '../utils/mcdata.js';
import * as mc from '../utils/mcdata.js';
import { containsCommand, commandExists, executeCommand, truncCommandMessage, isAction, blacklistCommands, parseCommandMessage, getCommand } from './commands/index.js';
import { ActionManager } from './action_manager.js';
import { NPCContoller } from './npc/controller.js';
import { MemoryBank } from './memory_bank.js';
import { SelfPrompter } from './self_prompter.js';
import convoManager from './conversation.js';
import { handleTranslation, handleEnglishTranslation } from '../utils/translator.js';
import { addBrowserViewer } from './vision/browser_viewer.js';
import { serverProxy, sendOutputToServer } from './mindserver_proxy.js';
import settings from './settings.js';
import { Task } from './tasks/tasks.js';
import { speak } from './speak.js';
import { log, validateNameFormat, handleDisconnection } from './connection_handler.js';
import * as skills from './library/skills.js';
import * as world from './library/world.js';

export class Agent {
    async start(load_mem = false, init_message = null, count_id = 0) {
        this.last_sender = null;
        this.count_id = count_id;
        this._disconnectHandled = false;
        this.request_seq = 0;
        this.current_request_id = null;
        this._handleMessageLock = Promise.resolve(); // async mutex for handleMessage

        // Initialize components
        this.actions = new ActionManager(this);
        this.prompter = new Prompter(this, settings.profile);
        this.name = (this.prompter.getName() || '').trim();
        console.log(`Initializing agent ${this.name}...`);

        // Validate Name Format
        // connection_handler now ensures the message has [LoginGuard] prefix
        const nameCheck = validateNameFormat(this.name);
        if (!nameCheck.success) {
            log(this.name, nameCheck.msg);
            process.exit(1);
            return;
        }

        this.history = new History(this);
        this.coder = new Coder(this);
        this.npc = new NPCContoller(this);
        this.memory_bank = new MemoryBank();
        this.memory_bank.initSpatialMemory(this.name);
        this.memory_bank.loadSpatialMemory();
        this.self_prompter = new SelfPrompter(this);
        convoManager.initAgent(this);
        await this.prompter.initExamples();

        // load mem first before doing task
        let save_data = null;
        if (load_mem) {
            save_data = this.history.load();
        }
        let taskStart = null;
        if (save_data) {
            taskStart = save_data.taskStart;
        } else {
            taskStart = Date.now();
        }
        try {
            this.task = new Task(this, settings.task, taskStart);
            this.blocked_actions = settings.blocked_actions.concat(this.task.blocked_actions || []);
            blacklistCommands(this.blocked_actions);

            this._initConnection(save_data, load_mem, init_message, count_id);
        } catch (error) {
            console.error('CRITICAL ERROR in Agent.start during task/connection init:', error);
            process.exit(1);
        }
    }

    _initConnection(save_data, load_mem, init_message, count_id) {
        console.log(this.name, 'logging into minecraft...');
        this.bot = initBot(this.name);
        this.bot.mindcraft_agent = this;

        // Connection Handler with Auto-Reconnect
        const onDisconnect = (event, reason) => {
            if (this._disconnectHandled) return;
            this._disconnectHandled = true;

            const { type, isFatal, msg } = handleDisconnection(this.name, reason);

            if (isFatal) {
                console.log(`[${this.name}] Fatal disconnect. Exiting...`);
                process.exit(1);
            } else {
                this.reconnect_attempts = (this.reconnect_attempts || 0) + 1;
                const backoff = Math.min(1000 * Math.pow(2, this.reconnect_attempts), 60000); // Max 1 min backoff
                console.log(`[${this.name}] Non-fatal disconnect. Reconnecting in ${backoff / 1000}s (Attempt ${this.reconnect_attempts})...`);

                // Cleanup previous instances before reconnecting
                if (this.bot) {
                    this.bot.removeAllListeners();
                }

                setTimeout(() => {
                    this._disconnectHandled = false;
                    this._initConnection(save_data, load_mem, init_message, count_id);
                }, backoff);
            }
        };

        // Bind events
        this.bot.once('kicked', (reason) => onDisconnect('Kicked', reason));
        this.bot.once('end', (reason) => onDisconnect('Disconnected', reason));
        this.bot.on('error', (err) => {
            if (String(err).includes('Duplicate') || String(err).includes('ECONNREFUSED')) {
                onDisconnect('Error', err);
            } else {
                log(this.name, `[LoginGuard] Connection Error: ${String(err)}`);
            }
        });

        initModes(this);

        this.bot.on('login', () => {
            console.log(this.name, 'logged in!');
            this.reconnect_attempts = 0; // Reset backoff on success
            serverProxy.login();

            // Set skin for profile
            if (this.prompter.profile.skin)
                this.bot.chat(`/skin set URL ${this.prompter.profile.skin.model} ${this.prompter.profile.skin.path}`);
            else
                this.bot.chat(`/skin clear`);
        });

        const spawnTimeoutDuration = settings.spawn_timeout;
        const spawnTimeout = setTimeout(() => {
            const msg = `Bot has not spawned after ${spawnTimeoutDuration} seconds. Exiting.`;
            log(this.name, msg);
            onDisconnect('SpawnTimeout', msg);
        }, spawnTimeoutDuration * 1000);

        this.bot.once('spawn', async () => {
            try {
                clearTimeout(spawnTimeout);
                addBrowserViewer(this.bot, count_id);
                console.log('Initializing vision intepreter...');
                this.vision_interpreter = new VisionInterpreter(this, settings.allow_vision);

                // wait for a bit so stats are not undefined
                await new Promise((resolve) => setTimeout(resolve, 1000));

                console.log(`${this.name} spawned.`);
                this.clearBotLogs();

                this._setupEventHandlers(save_data, init_message);
                this.startEvents();

                if (!load_mem) {
                    if (settings.task) {
                        this.task.initBotTask();
                        this.task.setAgentGoal();
                    }
                } else {
                    // set the goal without initializing the rest of the task
                    if (settings.task) {
                        this.task.setAgentGoal();
                    }
                }

                await new Promise((resolve) => setTimeout(resolve, 10000));
                this.checkAllPlayersPresent();

            } catch (error) {
                console.error('Error in spawn event:', error);
                onDisconnect('SpawnError', error);
            }
        });
    }

    async _setupEventHandlers(save_data, init_message) {
        const ignore_messages = [
            "Set own game mode to",
            "Set the time to",
            "Set the difficulty to",
            "Teleported ",
            "Set the weather to",
            "Gamerule "
        ];

        const respondFunc = async (username, message) => {
            if (message === "") return;
            if (username === this.name) return;
            if (settings.only_chat_with.length > 0 && !settings.only_chat_with.includes(username)) return;
            try {
                if (ignore_messages.some((m) => message.startsWith(m))) return;

                this.shut_up = false;

                console.log(this.name, 'received message from', username, ':', message);

                if (convoManager.isOtherAgent(username)) {
                    console.warn('received whisper from other bot??')
                }
                else {
                    this.handleMessage(username, message);
                }
            } catch (error) {
                console.error('Error handling message:', error);
            }
        }

        this.respondFunc = respondFunc;

        this.bot.on('whisper', respondFunc);

        this.bot.on('chat', (username, message) => {
            if (serverProxy.getNumOtherAgents() > 0) return;
            // only respond to open chat messages when there are no other agents
            respondFunc(username, message);
        });

        // Set up auto-eat
        this.bot.autoEat.options = {
            priority: 'foodPoints',
            startAt: 14,
            bannedFood: ["rotten_flesh", "spider_eye", "poisonous_potato", "pufferfish", "chicken"]
        };

        if (save_data?.self_prompt) {
            if (init_message) {
                this.history.add('system', init_message);
            }
            await this.self_prompter.handleLoad(save_data.self_prompt, save_data.self_prompting_state);
        }
        if (save_data?.last_sender) {
            this.last_sender = save_data.last_sender;
            if (convoManager.otherAgentInGame(this.last_sender)) {
                const msg_package = {
                    message: `You have restarted and this message is auto-generated. Continue the conversation with me.`,
                    start: true
                };
                convoManager.receiveFromBot(this.last_sender, msg_package);
            }
        }
        else if (init_message) {
            await this.handleMessage('system', init_message, 2);
        }
        else {
            this.openChat("Hello world! I am " + this.name);
        }
    }

    checkAllPlayersPresent() {
        if (!this.task || !this.task.agent_names) {
            return;
        }

        const missingPlayers = this.task.agent_names.filter(name => !this.bot.players[name]);
        if (missingPlayers.length > 0) {
            console.log(`Missing players/bots: ${missingPlayers.join(', ')}`);
            this.cleanKill('Not all required players/bots are present in the world. Exiting.', 4);
        }
    }

    requestInterrupt() {
        this.bot.interrupt_code = true;
        this.bot.stopDigging();
        this.bot.collectBlock.cancelTask();
        this.bot.pathfinder.stop();
        this.bot.pvp.stop();
    }

    clearBotLogs() {
        this.bot.output = '';
        this.bot.interrupt_code = false;
    }

    shutUp() {
        this.shut_up = true;
        if (this.self_prompter.isActive()) {
            this.self_prompter.stop(false);
        }
        convoManager.endAllConversations();
    }

    _nextRequestId(source = 'unknown') {
        this.request_seq += 1;
        const safeSource = String(source || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_');
        return `${this.name || 'agent'}-${Date.now()}-${this.request_seq}-${safeSource}`;
    }

    async handleMessage(source, message, max_responses = null) {
        // Serialize concurrent handleMessage calls via async mutex
        let releaseLock;
        const lockPromise = new Promise(resolve => { releaseLock = resolve; });
        const prevLock = this._handleMessageLock;
        this._handleMessageLock = lockPromise;
        await prevLock;

        const prevRequestId = this.current_request_id;
        const requestId = this._nextRequestId(source);
        this.current_request_id = requestId;
        try {
            if (!source || !message) {
                console.warn('Received empty message from', source);
                return false;
            }

            let used_command = false;
            if (max_responses === null) {
                max_responses = settings.max_commands === -1 ? Infinity : settings.max_commands;
            }
            if (max_responses === -1) {
                max_responses = Infinity;
            }

            const self_prompt = source === 'system' || source === this.name;
            const from_other_bot = convoManager.isOtherAgent(source);

            if (!self_prompt && !from_other_bot) { // from user, execute command directly if provided
                const user_command_name = containsCommand(message);
                if (user_command_name) {
                    if (!commandExists(user_command_name)) {
                        this.routeResponse(source, `Command '${user_command_name}' does not exist.`);
                        return false;
                    }
                    this.routeResponse(source, `*${source} used ${user_command_name.substring(1)}*`);
                    if (user_command_name === '!newAction') {
                        // all user-initiated commands are ignored by the bot except for this one
                        // add the preceding message to the history to give context for newAction
                        this.history.add(source, message);
                    }
                    
                    const executeRes = await executeCommand(this, message);
                    if (executeRes != null) {
                        this.routeResponse(source, String(executeRes));
                    }
                    return true;
                }
            }

            if (from_other_bot)
                this.last_sender = source;

            // Now translate the message
            message = await handleEnglishTranslation(message);
            console.log(`[request:${requestId}] received message from`, source, ':', message);

            const checkInterrupt = () => this.self_prompter.shouldInterrupt(self_prompt) || this.shut_up || convoManager.responseScheduledFor(source);

            let behavior_log = this.bot.modes.flushBehaviorLog().trim();
            if (behavior_log.length > 0) {
                const MAX_LOG = 500;
                if (behavior_log.length > MAX_LOG) {
                    behavior_log = '...' + behavior_log.substring(behavior_log.length - MAX_LOG);
                }
                behavior_log = 'Recent behaviors log: \n' + behavior_log;
                await this.history.add('system', behavior_log);
            }

            // Handle other user messages
            await this.history.add(source, message);
            this.history.save();

            if (!self_prompt && this.self_prompter.isActive()) // message is from user during self-prompting
                max_responses = 1; // force only respond to this message, then let self-prompting take over
            for (let i = 0; i < max_responses; i++) {
                if (checkInterrupt()) break;
                let history = this.history.getHistory();
                let res = await this.prompter.promptConvo(history);

                console.log(`${this.name} full response to ${source}: ""${res}""`);

                if (res.trim().length === 0) {
                    console.warn('no response')
                    break; // empty response ends loop
                }

                let command_name = containsCommand(res);

                if (command_name) { // contains query or command
                    res = truncCommandMessage(res); // everything after the command is ignored
                    this.history.add(this.name, res);

                    if (!commandExists(command_name)) {
                        this.history.add('system', `Command ${command_name} does not exist. Did you mean !craftRecipe? Please safely check the COMMAND DOCS strictly and try the correct command. Do not hallucinate commands.`);
                        console.warn('Agent hallucinated command:', command_name)
                        continue;
                    }

                    if (checkInterrupt()) break;
                    this.self_prompter.handleUserPromptedCmd(self_prompt, isAction(command_name));

                    if (settings.show_command_syntax === "full") {
                        this.routeResponse(source, res);
                    }
                    else if (settings.show_command_syntax === "shortened") {
                        // show only "used !commandname"
                        let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                        let chat_message = `*used ${command_name.substring(1)}*`;
                        if (pre_message.length > 0)
                            chat_message = `${pre_message}  ${chat_message}`;
                        this.routeResponse(source, chat_message);
                    }
                    else {
                        // no command at all
                        let pre_message = res.substring(0, res.indexOf(command_name)).trim();
                        if (pre_message.trim().length > 0)
                            this.routeResponse(source, pre_message);
                    }

                    const executeRes = await executeCommand(this, res);

                    console.log('Agent executed:', command_name, 'and got:', executeRes);
                    used_command = true;

                    if (executeRes)
                        this.history.add('system', String(executeRes));
                    else
                        break;
                }
                else { // conversation response
                    this.history.add(this.name, res);
                    this.routeResponse(source, res);
                    break;
                }

                this.history.save();
            }

            return used_command;
        } finally {
            this.current_request_id = prevRequestId;
            releaseLock(); // release async mutex
        }
    }

    async routeResponse(to_player, message) {
        if (this.shut_up) return;
        let self_prompt = to_player === 'system' || to_player === this.name;
        if (self_prompt && this.last_sender) {
            // this is for when the agent is prompted by system while still in conversation
            // so it can respond to events like death but be routed back to the last sender
            to_player = this.last_sender;
        }

        if (convoManager.isOtherAgent(to_player) && convoManager.inConversation(to_player)) {
            // if we're in an ongoing conversation with the other bot, send the response to it
            convoManager.sendToBot(to_player, message);
        }
        else {
            // otherwise, use open chat
            this.openChat(message);
            // note that to_player could be another bot, but if we get here the conversation has ended
        }
    }

    async openChat(message) {
        let to_translate = message;
        let remaining = '';
        let command_name = containsCommand(message);
        let translate_up_to = command_name ? message.indexOf(command_name) : -1;
        if (translate_up_to != -1) { // don't translate the command
            to_translate = to_translate.substring(0, translate_up_to);
            remaining = message.substring(translate_up_to);
        }
        message = (await handleTranslation(to_translate)).trim() + " " + remaining;
        // newlines are interpreted as separate chats, which triggers spam filters. replace them with spaces
        message = message.replaceAll('\n', ' ');

        if (settings.only_chat_with.length > 0) {
            for (let username of settings.only_chat_with) {
                this.bot.whisper(username, message);
            }
        }
        else {
            if (settings.speak) {
                speak(to_translate, this.prompter.profile.speak_model);
            }
            if (settings.chat_ingame) { this.bot.chat(message); }
            sendOutputToServer(this.name, message);
        }
    }

    startEvents() {
        // Custom events
        this.bot.on('time', () => {
            try {
                if (this.bot.time.timeOfDay == 0)
                    this.bot.emit('sunrise');
                else if (this.bot.time.timeOfDay == 6000)
                    this.bot.emit('noon');
                else if (this.bot.time.timeOfDay == 12000)
                    this.bot.emit('sunset');
                else if (this.bot.time.timeOfDay == 18000)
                    this.bot.emit('midnight');
            } catch (err) {
                console.error('[EventBoundary] time handler error:', err.message);
            }
        });

        // Single unified health listener
        this.bot.on('health', () => {
            try {
                if (this.bot.health < prev_health) {
                    const amount = prev_health - this.bot.health;
                    this.bot.lastDamageTime = Date.now();
                    this.bot.lastDamageTaken = amount;
                }
                prev_health = this.bot.health;
            } catch (err) {
                console.error('[EventBoundary] health handler error:', err.message);
            }
        });
        // Logging callbacks
        this.bot.on('error', (err) => {
            console.error('Error event!', err);
        });
        this.bot.on('death', () => {
            try {
                this.actions.cancelResume();
                this.actions.stop();
            } catch (err) {
                console.error('[EventBoundary] death handler error:', err.message);
            }
        });
        this.bot.on('kicked', (reason) => {
            if (!this._disconnectHandled) {
                const { msg } = handleDisconnection(this.name, reason);
                this.cleanKill(msg);
            }
        });
        this.bot.on('messagestr', async (message, _, jsonMsg) => {
            if (jsonMsg.translate && jsonMsg.translate.startsWith('death') && message.startsWith(this.name)) {
                console.log('Agent died: ', message);
                let death_pos = this.bot.entity.position;
                this.memory_bank.rememberPlace('last_death_position', death_pos.x, death_pos.y, death_pos.z);
                let death_pos_text = null;
                if (death_pos) {
                    death_pos_text = `x: ${death_pos.x.toFixed(2)}, y: ${death_pos.y.toFixed(2)}, z: ${death_pos.z.toFixed(2)}`;
                }
                let dimention = this.bot.game.dimension;

                this.handleMessage('system', `You died at position ${death_pos_text || "unknown"} in the ${dimention} dimension with the final message: '${message}'.\nYour place of death is saved as 'last_death_position' if you want to return. Previous actions were stopped and you have respawned. If you need to survive this in the future, consider using !newAction to teach yourself a defensive or survival skill.`);
            }
        });
        this.bot.on('idle', () => {
            try {
                this.bot.clearControlStates();
                this.bot.pathfinder.stop(); // clear any lingering pathfinder
                this.bot.modes.unPauseAll();
                // removed setTimeout call - moved to update loop for active polling
            } catch (err) {
                console.error('[EventBoundary] idle handler error:', err.message);
            }
        });

        // Spatial Memory: auto-remember valuable blocks near bot
        const VALUABLE_BLOCKS = new Set([
            'diamond_ore', 'deepslate_diamond_ore',
            'iron_ore', 'deepslate_iron_ore',
            'gold_ore', 'deepslate_gold_ore',
            'emerald_ore', 'deepslate_emerald_ore',
            'ancient_debris',
            'chest', 'crafting_table', 'furnace', 'blast_furnace', 'smoker',
            'enchanting_table', 'anvil', 'brewing_stand'
        ]);
        // B6: Task Interrupt configurations
        const INTERRUPT_BLOCKS = new Set(['diamond_ore', 'deepslate_diamond_ore', 'emerald_ore', 'deepslate_emerald_ore', 'ancient_debris']);
        let lastInterruptTime = 0;

        let lastSpatialScanPos = null;
        this.bot.on('move', () => {
            try {
                const pos = this.bot.entity.position;
                // Only scan every 8 blocks moved to avoid lag
                if (lastSpatialScanPos) {
                    const dx = pos.x - lastSpatialScanPos.x;
                    const dz = pos.z - lastSpatialScanPos.z;
                    if (dx * dx + dz * dz < 64) return; // 8^2
                }
                lastSpatialScanPos = pos.clone();
                // Scan nearby blocks for valuable ones using native API for performance (T1-#5)
                const scanRadius = 8;
                const blocks = this.bot.findBlocks({
                    matching: (block) => VALUABLE_BLOCKS.has(block.name),
                    maxDistance: scanRadius,
                    count: 20
                });

                for (const pos of blocks) {
                    if (this.bot.interrupt_code) return;
                    const block = this.bot.blockAt(pos);
                    if (!block) continue;

                    this.memory_bank.rememberBlock(block.name, block.position.x, block.position.y, block.position.z, this.bot.game.dimension);
                }
            } catch (err) {
                // Silently ignore — spatial scan is best-effort
            }
        });

        // Spatial Memory: invalidate when blocks are broken
        this.bot.on('blockUpdate', (oldBlock, newBlock) => {
            try {
                if (newBlock && newBlock.name === 'air' && oldBlock && oldBlock.name !== 'air') {
                    const bPos = newBlock.position;
                    if (bPos) {
                        this.memory_bank.forgetBlock(bPos.x, bPos.y, bPos.z, this.bot.game.dimension);
                    }
                }
            } catch (err) {
                // Silently ignore — invalidation is best-effort
            }
        });

        // B4: Auto-save spatial memory every 5 minutes to prevent data loss on crash
        setInterval(() => {
            try {
                this.memory_bank.enforceLimits();
                this.memory_bank.saveSpatialMemory();
            } catch (err) {
                console.error('Auto-save spatial memory failed:', err.message);
            }
        }, 5 * 60 * 1000);

        this.bot.emit('idle');
    }

    async update(delta) {
        await this.bot.modes.update();
        this.self_prompter.update(delta);
        await this.checkTaskDone();
    }

    isIdle() {
        return !this.actions.executing;
    }

    _normalizeTaskItemName(rawName) {
        if (!rawName) {
            return null;
        }
        let cleaned = rawName
            .toString()
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_ ]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .replaceAll(' ', '_');
        if (!cleaned) {
            return null;
        }

        const candidates = new Set([cleaned]);
        if (cleaned.endsWith('_logs')) candidates.add(cleaned.replace(/_logs$/, '_log'));
        if (cleaned.endsWith('_ingots')) candidates.add(cleaned.replace(/_ingots$/, '_ingot'));
        if (cleaned.endsWith('_ores')) candidates.add(cleaned.replace(/_ores$/, '_ore'));
        if (cleaned.endsWith('s')) candidates.add(cleaned.slice(0, -1));
        if (cleaned.endsWith('es')) candidates.add(cleaned.slice(0, -2));

        for (const candidate of candidates) {
            try {
                if (mc.getItemId(candidate) != null || mc.getBlockId(candidate) != null) {
                    return candidate;
                }
            } catch (_err) {
                return null;
            }
        }
        return null;
    }



    getDebugStateReport() {
        // ... debug report ...
        return '';
    }

    cleanKill(msg = 'Killing agent process...', code = 1) {
        this.history.add('system', msg);
        this.bot.chat(code > 1 ? 'Restarting.' : 'Exiting.');
        this.history.save();
        this.memory_bank.saveSpatialMemory();
        process.exit(code);
    }
    async checkTaskDone() {
        if (this.task.data) {
            let res = this.task.isDone();
            if (res) {
                await this.history.add('system', `Task ended with score : ${res.score}`);
                await this.history.save();
                // await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 second for save to complete
                console.log('Task finished:', res.message);
                this.killAll();
            }
        }
    }

    killAll() {
        serverProxy.shutdown();
    }
}
