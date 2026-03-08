import { writeFile, readFile, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { makeCompartment, lockdown } from './library/lockdown.js';
import * as skills from './library/skills.js';
import * as world from './library/world.js';
import { Vec3 } from 'vec3';
import { ESLint } from "eslint";
import { getCommand, registerCommand, unregisterCommand } from './commands/index.js';
import { createLearnedActionCommand, getLearnedCommandName } from './commands/actions.js';

export class Coder {
    constructor(agent) {
        this.agent = agent;
        this.file_counter = 0;
        this.fp = '/bots/' + agent.name + '/action-code/';
        this.learned_fp = '/bots/' + agent.name + '/learned/';
        this.learned_index_fp = '/bots/' + agent.name + '/learned/_index.json';
        this.learned_index = { actions: {} };
        this.learned_command_registry = new Set();
        this.code_template = '';
        this.code_lint_template = '';

        readFile('./bots/execTemplate.js', 'utf8', (err, data) => {
            if (err) throw err;
            this.code_template = data;
        });
        readFile('./bots/lintTemplate.js', 'utf8', (err, data) => {
            if (err) throw err;
            this.code_lint_template = data;
        });
        mkdirSync('.' + this.fp, { recursive: true });
        mkdirSync('.' + this.learned_fp, { recursive: true });
        this._loadLearnedActionIndex();
        this._copySeedSkills();
        this._syncLearnedActionCommands();
    }

    async generateCode(agent_history) {
        this.agent.bot.modes.pause('unstuck');
        lockdown();
        // this message history is transient and only maintained in this function
        let messages = agent_history.getHistory();
        messages.push({ role: 'system', content: 'Code generation started. Write code in codeblock in your response:' });
        const context = this._buildLearnedActionContext();
        const recommendedActions = this.getLearnedActionRecommendations(context, 12);
        if (recommendedActions.length > 0) {
            const recommendationLines = recommendedActions
                .map(rec => `- ${rec.name}: score=${rec.score.toFixed(2)}; ${rec.summary}`)
                .join('\n');
            messages.push({
                role: 'system',
                content: `Saved reusable actions are available via world.runAction("action_name"). Recommended actions for current context:\n${recommendationLines}\nUse world.listActions() to see all saved actions.`
            });
        } else {
            messages.push({
                role: 'system',
                content: 'No saved reusable actions are currently available.'
            });
        }
        if (typeof this.agent.getLongTermGoalContext === 'function') {
            const goalContext = this.agent.getLongTermGoalContext();
            if (goalContext) {
                messages.push({
                    role: 'system',
                    content: goalContext
                });
            }
        }

        const MAX_ATTEMPTS = 5;
        const MAX_NO_CODE = 3;

        let code = null;
        let no_code_failures = 0;
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            if (this.agent.bot.interrupt_code)
                return null;
            const messages_copy = JSON.parse(JSON.stringify(messages));
            let res = await this.agent.prompter.promptCoding(messages_copy);
            if (this.agent.bot.interrupt_code)
                return null;
            let contains_code = res.indexOf('```') !== -1;
            if (!contains_code) {
                if (res.indexOf('!newAction') !== -1) {
                    messages.push({
                        role: 'assistant',
                        content: res.substring(0, res.indexOf('!newAction'))
                    });
                    continue; // using newaction will continue the loop
                }

                if (no_code_failures >= MAX_NO_CODE) {
                    console.warn("Action failed, agent would not write code.");
                    return 'Action failed, agent would not write code.';
                }
                messages.push({
                    role: 'system',
                    content: 'Error: no code provided. Write code in codeblock in your response. ``` // example ```'
                }
                );
                console.warn("No code block generated. Trying again.");
                no_code_failures++;
                continue;
            }
            code = res.substring(res.indexOf('```') + 3, res.lastIndexOf('```'));
            const result = await this._stageCode(code);
            if (!result) {
                messages.push({ role: 'system', content: 'Error: failed to stage generated code. Please provide corrected code.' });
                continue;
            }
            const executionModule = result.func;
            const lintResult = await this._lintCode(result.src_lint_copy);
            if (lintResult) {
                const message = 'Error: Code lint error:' + '\n' + lintResult + '\nPlease try again.';
                console.warn("Linting error:" + '\n' + lintResult + '\n');
                messages.push({ role: 'system', content: message });
                continue;
            }
            if (!executionModule) {
                console.warn("Failed to stage code, something is wrong.");
                return 'Failed to stage code, something is wrong.';
            }

            try {
                console.log('Executing code...');
                await executionModule.main(this.agent.bot);

                const code_output = this.agent.actions.getBotOutputSummary();

                // Deep Audit V2: Phantom Failure Check (JS didn't throw error but bot logic actually failed)
                const outLower = String(code_output || '').toLowerCase();
                const failedRegex = /\n\s*failed\b/i;
                if (failedRegex.test(outLower) || outLower.includes("couldn't") || outLower.includes("cannot find") || outLower.includes("could not ")) {
                    throw new Error("Action Semantic Failure:\n" + code_output);
                }

                const summary = "Agent wrote this code: \n```" + this._sanitizeCode(code) + "```\nCode Output:\n" + code_output;
                return summary;
            } catch (e) {
                if (this.agent.bot.interrupt_code)
                    return null;

                console.warn('Generated code threw error: ' + e.toString());
                console.warn('trying again...');

                const code_output = this.agent.actions.getBotOutputSummary();
                let shortStack = e.stack ? e.stack.split('\n').slice(0, 3).join('\n') : e.toString();

                messages.push({
                    role: 'assistant',
                    content: res
                });
                messages.push({
                    role: 'system',
                    content: `Code Output:\n${code_output}\nCODE EXECUTION THREW ERROR: ${shortStack}\n Please try again:`
                });
            }
        }
        return `Code generation failed after ${MAX_ATTEMPTS} attempts.`;
    }

    async generateStructuredPlan(agent_history) {
        this.agent.bot.modes.pause('unstuck');

        let messages = agent_history.getHistory();
        messages.push({
            role: 'system',
            content: [
                'Structured planning started.',
                'Return STRICT JSON only with schema:',
                '{"plan_name":"string","steps":[{"skill":"skills.functionName or world.functionName","args":[...]}]}',
                'No markdown, no code fences, and no explanations.'
            ].join('\n')
        });

        const context = this._buildLearnedActionContext();
        const recommendedActions = this.getLearnedActionRecommendations(context, 12);
        if (recommendedActions.length > 0) {
            const recommendationLines = recommendedActions
                .map(rec => `- ${rec.name}: score=${rec.score.toFixed(2)}; ${rec.summary}`)
                .join('\n');
            messages.push({
                role: 'system',
                content: `Saved reusable actions are available via world.runAction("action_name"). Recommended actions for current context:\n${recommendationLines}\nUse world.listActions() to see all saved actions.`
            });
        } else {
            messages.push({
                role: 'system',
                content: 'No saved reusable actions are currently available.'
            });
        }

        if (typeof this.agent.getLongTermGoalContext === 'function') {
            const goalContext = this.agent.getLongTermGoalContext();
            if (goalContext) {
                messages.push({
                    role: 'system',
                    content: goalContext
                });
            }
        }

        const MAX_ATTEMPTS = 5;
        for (let i = 0; i < MAX_ATTEMPTS; i++) {
            if (this.agent.bot.interrupt_code) {
                return {
                    success: false,
                    error_code: 'interrupted',
                    message: 'Structured plan generation was interrupted.'
                };
            }

            const messagesCopy = JSON.parse(JSON.stringify(messages));
            const response = await this.agent.prompter.promptStructuredPlan(messagesCopy);

            if (this.agent.bot.interrupt_code) {
                return {
                    success: false,
                    error_code: 'interrupted',
                    message: 'Structured plan generation was interrupted.'
                };
            }

            const extracted = this._extractStructuredPlan(response);
            if (!extracted.success) {
                messages.push({
                    role: 'system',
                    content: `Error: invalid JSON plan. ${extracted.message} Return only valid JSON using the required schema.`
                });
                continue;
            }

            if (extracted.plan.steps.length === 0 && extracted.plan.plan_name === 'cannot_complete') {
                return {
                    success: false,
                    error_code: 'cannot_complete',
                    message: 'Structured planner could not find an executable plan with available functions.'
                };
            }

            const validation = await this._validateStructuredPlan(extracted.plan);
            if (!validation.success) {
                messages.push({ role: 'assistant', content: response });
                messages.push({
                    role: 'system',
                    content: `Error: ${validation.message} Return a corrected JSON plan using only valid functions and args.`
                });
                continue;
            }

            const execution = await this._executeStructuredPlan(validation.plan, validation.steps);
            if (execution.success) {
                return execution;
            }

            if (execution.error_code === 'interrupted') {
                return execution;
            }

            messages.push({ role: 'assistant', content: response });
            messages.push({
                role: 'system',
                content: `Plan execution failed: ${execution.message}\nWrite a corrected JSON plan that avoids this failure.`
            });
        }

        return {
            success: false,
            error_code: 'plan_generation_failed',
            message: `Structured plan generation failed after ${MAX_ATTEMPTS} attempts.`
        };
    }

    _extractStructuredPlan(responseText) {
        if (typeof responseText !== 'string' || responseText.trim().length === 0) {
            return {
                success: false,
                message: 'Model response was empty.'
            };
        }

        let text = responseText.trim();
        if (text.includes('```')) {
            const firstFence = text.indexOf('```');
            const lastFence = text.lastIndexOf('```');
            if (lastFence > firstFence) {
                text = text.substring(firstFence + 3, lastFence).trim();
            }
        }
        if (text.toLowerCase().startsWith('json')) {
            text = text.substring(4).trim();
        }

        let parsed = null;
        try {
            parsed = JSON.parse(text);
        } catch (_err) {
            const candidates = [];
            const objectStart = text.indexOf('{');
            const objectEnd = text.lastIndexOf('}');
            if (objectStart !== -1 && objectEnd > objectStart) {
                candidates.push(text.substring(objectStart, objectEnd + 1));
            }
            const arrayStart = text.indexOf('[');
            const arrayEnd = text.lastIndexOf(']');
            if (arrayStart !== -1 && arrayEnd > arrayStart) {
                candidates.push(text.substring(arrayStart, arrayEnd + 1));
            }
            for (const candidate of candidates) {
                try {
                    parsed = JSON.parse(candidate);
                    break;
                } catch (_nestedErr) {
                    // ignore parse failure and continue
                }
            }
        }

        if (parsed == null) {
            return {
                success: false,
                message: 'Could not parse JSON.'
            };
        }

        let plan = null;
        if (Array.isArray(parsed)) {
            plan = {
                plan_name: 'generated_plan',
                steps: parsed
            };
        } else if (typeof parsed === 'object' && parsed !== null && Array.isArray(parsed.steps)) {
            plan = {
                plan_name: this._sanitizeStructuredPlanName(parsed.plan_name || parsed.name || 'generated_plan'),
                steps: parsed.steps
            };
        }

        if (!plan) {
            return {
                success: false,
                message: 'JSON did not match structured plan schema.'
            };
        }
        return {
            success: true,
            plan
        };
    }

    async _validateStructuredPlan(plan) {
        if (!plan || typeof plan !== 'object') {
            return {
                success: false,
                message: 'Plan must be an object.'
            };
        }
        if (!Array.isArray(plan.steps)) {
            return {
                success: false,
                message: 'Plan must include a steps array.'
            };
        }
        if (plan.steps.length === 0) {
            return {
                success: false,
                message: 'Plan has no executable steps.'
            };
        }
        if (plan.steps.length > 12) {
            return {
                success: false,
                message: `Plan has too many steps (${plan.steps.length}). Maximum allowed is 12.`
            };
        }

        const availableFromDocs = new Set();
        const allDocs = await this.agent.prompter.skill_libary.getAllSkillDocs();
        for (const doc of allDocs || []) {
            const firstLine = (doc || '').split('\n')[0].trim();
            if (/^(skills|world)\.[a-zA-Z0-9_]+$/.test(firstLine)) {
                availableFromDocs.add(firstLine);
            }
        }
        if (availableFromDocs.size === 0) {
            for (const fnName of Object.keys(skills)) {
                if (typeof skills[fnName] === 'function') {
                    availableFromDocs.add(`skills.${fnName}`);
                }
            }
            for (const fnName of Object.keys(world)) {
                if (typeof world[fnName] === 'function') {
                    availableFromDocs.add(`world.${fnName}`);
                }
            }
        }

        const validatedSteps = [];
        for (let i = 0; i < plan.steps.length; i++) {
            const step = plan.steps[i];
            if (!step || typeof step !== 'object') {
                return {
                    success: false,
                    message: `Step ${i + 1} must be an object.`
                };
            }
            if (typeof step.skill !== 'string' || step.skill.trim().length === 0) {
                return {
                    success: false,
                    message: `Step ${i + 1} is missing a valid skill field.`
                };
            }
            if (!availableFromDocs.has(step.skill)) {
                return {
                    success: false,
                    message: `Step ${i + 1} uses unavailable function "${step.skill}".`
                };
            }

            const callable = this._resolveStructuredFunction(step.skill);
            if (!callable.success) {
                return {
                    success: false,
                    message: `Step ${i + 1} invalid function "${step.skill}": ${callable.message}`
                };
            }

            const args = Array.isArray(step.args) ? step.args : [];
            for (let argIndex = 0; argIndex < args.length; argIndex++) {
                if (!this._validateStructuredArgValue(args[argIndex])) {
                    return {
                        success: false,
                        message: `Step ${i + 1} has invalid arg at index ${argIndex}.`
                    };
                }
            }

            validatedSteps.push({
                index: i,
                skill: step.skill,
                args,
                fn: callable.fn
            });
        }

        return {
            success: true,
            plan: {
                plan_name: this._sanitizeStructuredPlanName(plan.plan_name || 'generated_plan'),
                steps: plan.steps
            },
            steps: validatedSteps
        };
    }

    _resolveStructuredFunction(skillPath) {
        if (typeof skillPath !== 'string') {
            return {
                success: false,
                message: 'Function path must be a string.'
            };
        }
        const parts = skillPath.split('.');
        if (parts.length !== 2) {
            return {
                success: false,
                message: 'Function path must be in namespace.name format.'
            };
        }
        const namespace = parts[0];
        const functionName = parts[1];
        let fn = null;
        if (namespace === 'skills') {
            fn = skills[functionName];
        } else if (namespace === 'world') {
            fn = world[functionName];
        } else {
            return {
                success: false,
                message: `Unknown namespace "${namespace}".`
            };
        }
        if (typeof fn !== 'function') {
            return {
                success: false,
                message: `Function "${skillPath}" does not exist at runtime.`
            };
        }
        return {
            success: true,
            fn
        };
    }

    _validateStructuredArgValue(value, depth = 0) {
        if (depth > 8) {
            return false;
        }
        if (value === null) {
            return true;
        }
        const valueType = typeof value;
        if (valueType === 'string') {
            return true;
        }
        if (valueType === 'number') {
            return Number.isFinite(value);
        }
        if (valueType === 'boolean') {
            return true;
        }
        if (Array.isArray(value)) {
            return value.every(entry => this._validateStructuredArgValue(entry, depth + 1));
        }
        if (valueType === 'object') {
            if (Object.keys(value).length > 40) {
                return false;
            }
            return Object.values(value).every(entry => this._validateStructuredArgValue(entry, depth + 1));
        }
        return false;
    }

    _sanitizeStructuredPlanName(name) {
        if (typeof name !== 'string') {
            return 'generated_plan';
        }
        let normalized = name
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9_\- ]/g, '')
            .replaceAll(' ', '_')
            .replace(/_+/g, '_');
        if (!normalized) {
            normalized = 'generated_plan';
        }
        if (normalized.length > 64) {
            normalized = normalized.slice(0, 64);
        }
        return normalized;
    }

    _getStructuredRuntimeContext() {
        const botPos = this.agent.bot?.entity?.position || { x: 0, y: 0, z: 0 };
        return {
            pos: {
                x: botPos.x,
                y: botPos.y,
                z: botPos.z
            },
            bot: {
                position: {
                    x: botPos.x,
                    y: botPos.y,
                    z: botPos.z
                },
                dimension: this.agent.bot?.game?.dimension || null
            },
            inventory: world.getInventoryCounts(this.agent.bot)
        };
    }

    _resolveStructuredArgValue(value, context, depth = 0) {
        if (depth > 8) {
            throw new Error('Argument nesting depth exceeded.');
        }
        if (value === null) {
            return null;
        }
        const valueType = typeof value;
        if (valueType === 'string') {
            if (!value.startsWith('$')) {
                return value;
            }
            const path = value.slice(1).trim();
            if (!/^[a-zA-Z0-9_.]+$/.test(path)) {
                throw new Error(`Invalid placeholder path "${value}".`);
            }
            const keys = path.split('.');
            let current = context;
            for (const key of keys) {
                if (!current || typeof current !== 'object' || !(key in current)) {
                    throw new Error(`Unknown placeholder "${value}".`);
                }
                current = current[key];
            }
            if (typeof current === 'function' || current === undefined) {
                throw new Error(`Placeholder "${value}" resolved to unsupported value.`);
            }
            return current;
        }
        if (valueType === 'number' || valueType === 'boolean') {
            return value;
        }
        if (Array.isArray(value)) {
            return value.map(entry => this._resolveStructuredArgValue(entry, context, depth + 1));
        }
        if (valueType === 'object') {
            const resolved = {};
            for (const [key, entry] of Object.entries(value)) {
                resolved[key] = this._resolveStructuredArgValue(entry, context, depth + 1);
            }
            return resolved;
        }
        throw new Error('Unsupported argument value type.');
    }

    _normalizeStructuredStepResult(stepResult) {
        if (stepResult === false) {
            return {
                success: false,
                reason: 'Step returned false.'
            };
        }
        if (stepResult && typeof stepResult === 'object') {
            if (stepResult.success === false) {
                return {
                    success: false,
                    reason: stepResult.reason || stepResult.message || 'Step reported failure.'
                };
            }
            if (stepResult.error_code && stepResult.error_code !== 'none' && stepResult.success !== true) {
                return {
                    success: false,
                    reason: stepResult.reason || stepResult.message || `Step returned error code ${stepResult.error_code}.`
                };
            }
        }
        return {
            success: true,
            reason: 'ok'
        };
    }

    _formatStructuredPlan(plan, maxSteps = 12) {
        if (!plan || !Array.isArray(plan.steps)) {
            return '';
        }
        const lines = [];
        const shown = plan.steps.slice(0, maxSteps);
        for (let i = 0; i < shown.length; i++) {
            const step = shown[i];
            const args = Array.isArray(step.args) ? step.args : [];
            const argText = args.map(arg => {
                try {
                    return JSON.stringify(arg);
                } catch (_err) {
                    return '"[unserializable]"';
                }
            }).join(', ');
            lines.push(`${i + 1}. ${step.skill}(${argText})`);
        }
        if (plan.steps.length > shown.length) {
            lines.push(`... ${plan.steps.length - shown.length} more step(s) hidden.`);
        }
        return lines.join('\n');
    }

    async _executeStructuredPlan(plan, validatedSteps) {
        const totalSteps = validatedSteps.length;
        let completedSteps = 0;

        for (const step of validatedSteps) {
            if (this.agent.bot.interrupt_code) {
                return {
                    success: false,
                    error_code: 'interrupted',
                    message: `Structured plan "${plan.plan_name}" was interrupted before step ${step.index + 1}.`
                };
            }

            let resolvedArgs = [];
            try {
                const runtimeContext = this._getStructuredRuntimeContext();
                resolvedArgs = step.args.map(arg => this._resolveStructuredArgValue(arg, runtimeContext));
            } catch (argErr) {
                const output = this.agent.actions.getBotOutputSummary();
                let message = `Structured plan "${plan.plan_name}" failed at step ${step.index + 1}/${totalSteps} (${step.skill}): ${argErr.message}`;
                const formattedPlan = this._formatStructuredPlan(plan);
                if (formattedPlan) {
                    message += `\nPlan:\n${formattedPlan}`;
                }
                if (output && output.trim().length > 0) {
                    message += `\nExecution Output:\n${output}`;
                }
                return {
                    success: false,
                    error_code: 'invalid_args',
                    message
                };
            }

            let stepResult = null;
            try {
                stepResult = await step.fn(this.agent.bot, ...resolvedArgs);
            } catch (execErr) {
                const output = this.agent.actions.getBotOutputSummary();
                let message = `Structured plan "${plan.plan_name}" failed at step ${step.index + 1}/${totalSteps} (${step.skill}): ${execErr.message}`;
                const formattedPlan = this._formatStructuredPlan(plan);
                if (formattedPlan) {
                    message += `\nPlan:\n${formattedPlan}`;
                }
                if (output && output.trim().length > 0) {
                    message += `\nExecution Output:\n${output}`;
                }
                return {
                    success: false,
                    error_code: 'execution_failed',
                    message
                };
            }

            const normalized = this._normalizeStructuredStepResult(stepResult);
            if (!normalized.success) {
                const output = this.agent.actions.getBotOutputSummary();
                let message = `Structured plan "${plan.plan_name}" failed at step ${step.index + 1}/${totalSteps} (${step.skill}): ${normalized.reason}`;
                const formattedPlan = this._formatStructuredPlan(plan);
                if (formattedPlan) {
                    message += `\nPlan:\n${formattedPlan}`;
                }
                if (output && output.trim().length > 0) {
                    message += `\nExecution Output:\n${output}`;
                }
                return {
                    success: false,
                    error_code: 'step_failed',
                    message
                };
            }

            completedSteps += 1;
        }

        const output = this.agent.actions.getBotOutputSummary();
        let message = `Structured plan "${plan.plan_name}" completed (${completedSteps}/${totalSteps} steps).`;
        const formattedPlan = this._formatStructuredPlan(plan);
        if (formattedPlan) {
            message += `\nPlan:\n${formattedPlan}`;
        }
        if (output && output.trim().length > 0) {
            message += `\nExecution Output:\n${output}`;
        }
        return {
            success: true,
            error_code: 'none',
            message
        };
    }

    _loadLearnedActionIndex() {
        const indexFile = '.' + this.learned_index_fp;
        if (!existsSync(indexFile)) {
            this.learned_index = { actions: {} };
            return;
        }
        try {
            const parsed = JSON.parse(readFileSync(indexFile, 'utf8'));
            if (!parsed || typeof parsed !== 'object' || !parsed.actions || typeof parsed.actions !== 'object') {
                this.learned_index = { actions: {} };
                return;
            }
            this.learned_index = parsed;
        } catch (err) {
            console.warn('Failed to load learned action index, resetting:', err);
            this.learned_index = { actions: {} };
        }
    }

    _copySeedSkills() {
        const seedPath = './profiles/defaults/seed_skills/';
        if (!existsSync(seedPath)) return;

        try {
            let indexUpdated = false;
            const files = readdirSync(seedPath);
            for (const file of files) {
                if (!file.endsWith('.js')) continue;
                const actionName = file.replace('.js', '');
                const targetFile = '.' + this.learned_fp + file;

                if (!existsSync(targetFile)) {
                    const source = readFileSync(seedPath + file, 'utf8');
                    writeFileSync(targetFile, source, 'utf8');

                    // Read the description from the first block comment or assign a default
                    let summary = `Seed skill for ${actionName}`;
                    const commentMatch = source.match(/\/\*\*([\s\S]*?)\*\//);
                    if (commentMatch) {
                        summary = commentMatch[1].replace(/\*+/g, '').replace(/\n/g, ' ').trim();
                    }

                    this.learned_index.actions[actionName] = {
                        metadata: { type: 'seed' },
                        summary: summary
                    };
                    indexUpdated = true;
                    console.log(`Copied seed skill: ${actionName}`);
                }
            }
            if (indexUpdated) {
                this._saveLearnedActionIndex();
            }
        } catch (err) {
            console.warn('Failed to copy seed skills:', err);
        }
    }

    _saveLearnedActionIndex() {
        try {
            writeFileSync('.' + this.learned_index_fp, JSON.stringify(this.learned_index, null, 2), 'utf8');
        } catch (err) {
            console.warn('Failed to save learned action index:', err);
        }
    }

    _buildLearnedActionContext() {
        let biome = null;
        try {
            biome = world.getBiomeName(this.agent.bot);
        } catch (_err) {
            biome = null;
        }
        return {
            inventory_counts: world.getInventoryCounts(this.agent.bot),
            dimension: this.agent.bot?.game?.dimension || null,
            biome
        };
    }

    _normalizeMetadataString(value) {
        if (typeof value !== 'string') {
            return null;
        }
        const normalized = value.trim().toLowerCase().replaceAll(' ', '_');
        return normalized.length > 0 ? normalized : null;
    }

    _normalizeMetadataArray(values) {
        if (!Array.isArray(values)) {
            return [];
        }
        const normalized = [];
        for (const value of values) {
            const normalizedValue = this._normalizeMetadataString(value);
            if (normalizedValue && !normalized.includes(normalizedValue)) {
                normalized.push(normalizedValue);
            }
        }
        return normalized;
    }

    _extractRequiredItemsFromSource(source) {
        if (typeof source !== 'string' || source.trim().length === 0) {
            return [];
        }
        const required = new Set();
        const patterns = [
            /skills\.equip\(\s*bot\s*,\s*['"]([a-z0-9_]+)['"]/g,
            /skills\.placeBlock\(\s*bot\s*,\s*['"]([a-z0-9_]+)['"]/g,
            /skills\.useToolOn\(\s*bot\s*,\s*['"]([a-z0-9_]+)['"]/g,
            /skills\.useToolOnBlock\(\s*bot\s*,\s*['"]([a-z0-9_]+)['"]/g,
        ];
        for (const pattern of patterns) {
            let match = null;
            while ((match = pattern.exec(source)) !== null) {
                const itemName = this._normalizeMetadataString(match[1]);
                if (itemName && itemName !== 'hand' && itemName !== 'air') {
                    required.add(itemName);
                }
            }
        }
        return [...required];
    }

    _buildLearnedActionMetadata(actionName, source, incomingMetadata = null, previousMetadata = null) {
        const nowIso = new Date().toISOString();
        const base = previousMetadata ? { ...previousMetadata } : {};
        const incoming = (incomingMetadata && typeof incomingMetadata === 'object') ? incomingMetadata : {};

        const inferredItems = this._extractRequiredItemsFromSource(source);
        const metadataItems = this._normalizeMetadataArray(incoming.required_items || []);
        const requiredItems = [...new Set([...metadataItems, ...inferredItems])];

        const preferredDimension = this._normalizeMetadataString(incoming.preferred_dimension || incoming.dimension || '') || base.preferred_dimension || null;
        const preferredBiome = this._normalizeMetadataString(incoming.preferred_biome || incoming.biome || '') || base.preferred_biome || null;
        const tags = this._normalizeMetadataArray(incoming.tags || base.tags || []);
        const normalizedGateStatus = this._normalizeMetadataString(incoming.gate_status || '') || this._normalizeMetadataString(base.gate_status || '') || 'unverified';
        const gateStatus = ['unverified', 'candidate', 'approved', 'blocked'].includes(normalizedGateStatus)
            ? normalizedGateStatus
            : 'unverified';

        return {
            action_name: actionName,
            created_at: base.created_at || nowIso,
            updated_at: nowIso,
            required_items: requiredItems,
            preferred_dimension: preferredDimension,
            preferred_biome: preferredBiome,
            tags,
            runs: Number.isFinite(base.runs) ? base.runs : 0,
            successes: Number.isFinite(base.successes) ? base.successes : 0,
            failures: Number.isFinite(base.failures) ? base.failures : 0,
            last_error: typeof base.last_error === 'string' ? base.last_error : '',
            last_run_at: base.last_run_at || null,
            last_success_at: base.last_success_at || null,
            last_failure_at: base.last_failure_at || null,
            gate_status: gateStatus,
            gate_failures: Number.isFinite(base.gate_failures) ? base.gate_failures : 0,
            gate_last_checked_at: base.gate_last_checked_at || null,
            gate_last_reason: typeof base.gate_last_reason === 'string' ? base.gate_last_reason : ''
        };
    }

    _ensureLearnedActionMetadata(actionName, source = '') {
        if (!this.learned_index.actions[actionName]) {
            this.learned_index.actions[actionName] = this._buildLearnedActionMetadata(actionName, source, null, null);
        }
        return this.learned_index.actions[actionName];
    }

    _checkLearnedActionPolicy(source) {
        const text = (source || '').toString();
        const blockedPatterns = [
            { pattern: /\bprocess\b/i, reason: 'Use of process is not allowed.' },
            { pattern: /\brequire\s*\(/i, reason: 'require() is not allowed.' },
            { pattern: /\bimport\s+.+from\s+['"]/i, reason: 'import is not allowed in learned actions.' },
            { pattern: /\bchild_process\b/i, reason: 'child_process is not allowed.' },
            { pattern: /\bfs\b/i, reason: 'filesystem access is not allowed.' },
            { pattern: /\bhttps?:\/\//i, reason: 'Direct network calls are not allowed in learned actions.' },
            { pattern: /\beval\s*\(/i, reason: 'eval() is not allowed.' },
            { pattern: /\bFunction\s*\(/i, reason: 'Function constructor is not allowed.' },
            { pattern: /setInterval\s*\(/i, reason: 'setInterval is not allowed.' },
            { pattern: /while\s*\(\s*true\s*\)/i, reason: 'Infinite loops are not allowed.' },
            { pattern: /for\s*\(\s*;\s*;\s*\)/i, reason: 'Infinite loops are not allowed.' },
        ];
        for (const rule of blockedPatterns) {
            if (rule.pattern.test(text)) {
                return { ok: false, reason: rule.reason };
            }
        }
        return { ok: true, reason: 'Policy checks passed.' };
    }

    _normalizeLearnedActionName(actionName) {
        if (typeof actionName !== 'string') {
            return null;
        }
        const normalized = actionName.trim().toLowerCase().replaceAll(' ', '_');
        if (!/^[a-z0-9_-]{1,64}$/.test(normalized)) {
            return null;
        }
        return normalized;
    }

    _sanitizeLearnedActionSource(source) {
        if (typeof source !== 'string') {
            return '';
        }
        let cleaned = source.trim();
        if (cleaned.includes('```')) {
            const firstFence = cleaned.indexOf('```');
            const lastFence = cleaned.lastIndexOf('```');
            if (lastFence > firstFence) {
                cleaned = cleaned.substring(firstFence + 3, lastFence);
            }
        }
        return this._sanitizeCode(cleaned).trim();
    }

    _registerLearnedActionCommand(actionName, metadata = null) {
        const normalizedActionName = this._normalizeLearnedActionName(actionName);
        if (!normalizedActionName) {
            return false;
        }
        const effectiveMetadata = metadata || this.learned_index.actions?.[normalizedActionName] || {};
        const learnedCommand = createLearnedActionCommand(normalizedActionName, effectiveMetadata);
        if (!learnedCommand) {
            return false;
        }

        const existingCommand = getCommand(learnedCommand.name);
        if (existingCommand && !existingCommand.learned_action_name) {
            console.warn(`Skipping learned command registration for "${normalizedActionName}" because command "${learnedCommand.name}" is already in use.`);
            return false;
        }
        if (existingCommand?.learned_action_name && existingCommand.learned_action_name !== normalizedActionName) {
            console.warn(`Skipping learned command registration for "${normalizedActionName}" due to command name collision with "${existingCommand.learned_action_name}".`);
            return false;
        }

        const registerResult = registerCommand(learnedCommand, { replace: true });
        if (!registerResult.success) {
            console.warn(registerResult.message);
            return false;
        }
        this.learned_command_registry.add(normalizedActionName);
        return true;
    }

    _unregisterLearnedActionCommand(actionName) {
        const normalizedActionName = this._normalizeLearnedActionName(actionName);
        if (!normalizedActionName) {
            return false;
        }
        const commandName = getLearnedCommandName(normalizedActionName);
        if (!commandName) {
            return false;
        }
        const existingCommand = getCommand(commandName);
        if (!existingCommand) {
            this.learned_command_registry.delete(normalizedActionName);
            return false;
        }
        if (!existingCommand.learned_action_name) {
            console.warn(`Skipping learned command removal for "${normalizedActionName}" because "${commandName}" is not a learned command.`);
            return false;
        }
        if (existingCommand.learned_action_name !== normalizedActionName) {
            console.warn(`Skipping learned command removal for "${normalizedActionName}" because "${commandName}" belongs to "${existingCommand.learned_action_name}".`);
            return false;
        }
        const removed = unregisterCommand(commandName);
        if (removed) {
            this.learned_command_registry.delete(normalizedActionName);
        }
        return removed;
    }

    _syncLearnedActionCommands() {
        const actionNames = this.getLearnedActions();
        const approvedActions = new Set();
        for (const actionName of actionNames) {
            const metadata = this.learned_index.actions?.[actionName];
            if (metadata?.gate_status === 'approved') {
                if (this._registerLearnedActionCommand(actionName, metadata)) {
                    approvedActions.add(actionName);
                }
            }
        }

        for (const actionName of [...this.learned_command_registry]) {
            if (!approvedActions.has(actionName)) {
                this._unregisterLearnedActionCommand(actionName);
            }
        }
    }

    getLearnedActions() {
        try {
            const fileActions = readdirSync('.' + this.learned_fp, { withFileTypes: true })
                .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
                .map(entry => entry.name.slice(0, -3))
                .sort();
            for (const actionName of Object.keys(this.learned_index.actions || {})) {
                if (!fileActions.includes(actionName)) {
                    delete this.learned_index.actions[actionName];
                }
            }
            return fileActions;
        } catch (err) {
            console.warn('Failed to list learned actions:', err);
            return [];
        }
    }

    getLearnedActionMetadata(actionName) {
        const normalized = this._normalizeLearnedActionName(actionName);
        if (!normalized) {
            return null;
        }
        return this.learned_index.actions?.[normalized] || null;
    }

    getLearnedActionRecommendations(context = {}, limit = 8) {
        const actionNames = this.getLearnedActions();
        if (actionNames.length === 0) {
            return [];
        }
        const inventory = context.inventory_counts || {};
        const dimension = this._normalizeMetadataString(context.dimension || '');
        const biome = this._normalizeMetadataString(context.biome || '');

        const scored = actionNames.map(actionName => {
            const metadata = this.learned_index.actions?.[actionName] || {};
            const runs = Number.isFinite(metadata.runs) ? metadata.runs : 0;
            const successes = Number.isFinite(metadata.successes) ? metadata.successes : 0;
            const failures = Number.isFinite(metadata.failures) ? metadata.failures : 0;
            const successRate = runs > 0 ? successes / runs : 0.5;

            let score = successRate * 3;
            if (runs > 0) {
                score += Math.min(runs, 10) * 0.05;
            }
            if (failures > successes && runs > 0) {
                score -= 0.8;
            }

            const requiredItems = Array.isArray(metadata.required_items) ? metadata.required_items : [];
            let requiredItemsPresent = 0;
            for (const item of requiredItems) {
                if ((inventory[item] || 0) > 0) {
                    requiredItemsPresent += 1;
                }
            }
            if (requiredItems.length > 0) {
                score += (requiredItemsPresent / requiredItems.length) * 2;
                if (requiredItemsPresent < requiredItems.length) {
                    score -= 0.8;
                }
            }

            if (metadata.preferred_dimension && dimension) {
                score += metadata.preferred_dimension === dimension ? 0.8 : -0.6;
            }
            if (metadata.preferred_biome && biome) {
                score += metadata.preferred_biome === biome ? 0.6 : -0.2;
            }

            const summaryParts = [];
            summaryParts.push(`runs=${runs}, success=${(successRate * 100).toFixed(0)}%`);
            if (requiredItems.length > 0) {
                summaryParts.push(`required=[${requiredItems.join(', ')}]`);
            }
            if (metadata.preferred_dimension) {
                summaryParts.push(`dimension=${metadata.preferred_dimension}`);
            }
            if (metadata.preferred_biome) {
                summaryParts.push(`biome=${metadata.preferred_biome}`);
            }

            return {
                name: actionName,
                score,
                summary: summaryParts.join('; ')
            };
        });

        return scored
            .sort((a, b) => b.score - a.score)
            .slice(0, limit);
    }

    saveLearnedAction(actionName, source, allowOverwrite = false, metadata = null) {
        const normalized = this._normalizeLearnedActionName(actionName);
        if (!normalized) {
            return {
                success: false,
                message: 'Invalid action name. Use only letters, numbers, underscores, or dashes.',
                actionName: null
            };
        }

        const sanitizedSource = this._sanitizeLearnedActionSource(source);
        if (!sanitizedSource) {
            return {
                success: false,
                message: `Cannot save action "${normalized}" because code is empty.`,
                actionName: normalized
            };
        }

        const actionFile = '.' + this.learned_fp + normalized + '.js';
        if (!allowOverwrite && existsSync(actionFile)) {
            return {
                success: false,
                message: `Action "${normalized}" already exists. Use world.optimizeAction to update it.`,
                actionName: normalized
            };
        }

        try {
            writeFileSync(actionFile, sanitizedSource, 'utf8');
            const previousMetadata = this.learned_index.actions?.[normalized] || null;
            const finalMetadata = this._buildLearnedActionMetadata(normalized, sanitizedSource, metadata, previousMetadata);
            finalMetadata.gate_status = 'unverified';
            finalMetadata.gate_failures = 0;
            finalMetadata.gate_last_checked_at = new Date().toISOString();
            finalMetadata.gate_last_reason = allowOverwrite
                ? 'Action updated; gate reset and requires re-approval.'
                : 'New action saved; gate checks required before trusted use.';
            this.learned_index.actions[normalized] = finalMetadata;
            this._saveLearnedActionIndex();
            this._unregisterLearnedActionCommand(normalized);
            return {
                success: true,
                message: `${allowOverwrite ? 'Updated' : 'Saved'} action "${normalized}".`,
                actionName: normalized
            };
        } catch (err) {
            console.error('Failed to save learned action:', err);
            return {
                success: false,
                message: `Failed to save action "${normalized}": ${err.message}`,
                actionName: normalized
            };
        }
    }

    async runLearnedAction(actionName) {
        const normalized = this._normalizeLearnedActionName(actionName);
        if (!normalized) {
            return {
                success: false,
                message: 'Invalid action name. Use only letters, numbers, underscores, or dashes.'
            };
        }

        const actionFile = '.' + this.learned_fp + normalized + '.js';
        if (!existsSync(actionFile)) {
            return {
                success: false,
                error_code: 'not_found',
                message: `Action "${normalized}" was not found.`
            };
        }

        let source = '';
        try {
            source = readFileSync(actionFile, 'utf8');
        } catch (err) {
            return {
                success: false,
                error_code: 'read_failed',
                message: `Failed to read action "${normalized}": ${err.message}`
            };
        }
        if (!source.trim()) {
            return {
                success: false,
                error_code: 'empty_source',
                message: `Action "${normalized}" is empty.`
            };
        }

        if (!Array.isArray(this.agent.bot.learned_action_stack)) {
            this.agent.bot.learned_action_stack = [];
        }
        const stack = this.agent.bot.learned_action_stack;
        const MAX_DEPTH = 5;
        if (stack.includes(normalized)) {
            return {
                success: false,
                error_code: 'recursive_call',
                message: `Refusing recursive learned action call for "${normalized}".`
            };
        }
        if (stack.length >= MAX_DEPTH) {
            return {
                success: false,
                error_code: 'max_depth_exceeded',
                message: `Learned action nesting exceeded max depth of ${MAX_DEPTH}.`
            };
        }

        const metadata = this._ensureLearnedActionMetadata(normalized, source);
        if (metadata.gate_status === 'blocked') {
            this._unregisterLearnedActionCommand(normalized);
            return {
                success: false,
                error_code: 'gate_blocked',
                message: `Action "${normalized}" is blocked by safety gate: ${metadata.gate_last_reason || 'no reason provided'}.`
            };
        }

        const policyCheck = this._checkLearnedActionPolicy(source);
        metadata.gate_last_checked_at = new Date().toISOString();
        if (!policyCheck.ok) {
            metadata.gate_failures = (Number.isFinite(metadata.gate_failures) ? metadata.gate_failures : 0) + 1;
            metadata.gate_last_reason = policyCheck.reason;
            metadata.gate_status = metadata.gate_failures >= 2 ? 'blocked' : 'unverified';
            metadata.updated_at = metadata.gate_last_checked_at;
            this._saveLearnedActionIndex();
            this._unregisterLearnedActionCommand(normalized);
            return {
                success: false,
                error_code: 'policy_violation',
                message: `Action "${normalized}" failed policy gate: ${policyCheck.reason}`
            };
        }

        stack.push(normalized);
        try {
            const staged = await this._stageCode(source);
            if (!staged || !staged.func || typeof staged.func.main !== 'function') {
                return {
                    success: false,
                    error_code: 'stage_failed',
                    message: `Failed to stage learned action "${normalized}".`
                };
            }

            const lintResult = await this._lintCode(staged.src_lint_copy);
            if (lintResult) {
                metadata.gate_failures = (Number.isFinite(metadata.gate_failures) ? metadata.gate_failures : 0) + 1;
                metadata.gate_last_reason = 'Lint checks failed.';
                metadata.gate_status = metadata.gate_failures >= 2 ? 'blocked' : 'unverified';
                metadata.updated_at = new Date().toISOString();
                this._saveLearnedActionIndex();
                this._unregisterLearnedActionCommand(normalized);
                return {
                    success: false,
                    error_code: 'lint_failed',
                    message: `Learned action "${normalized}" failed lint checks.\n${lintResult}`
                };
            }

            if (metadata.gate_status !== 'approved') {
                metadata.gate_status = 'candidate';
                metadata.gate_last_reason = 'Awaiting successful runtime execution to approve.';
                metadata.updated_at = new Date().toISOString();
                this._saveLearnedActionIndex();
                this._unregisterLearnedActionCommand(normalized);
            }

            await staged.func.main(this.agent.bot);
            this._recordLearnedActionRun(normalized, true, null);
            if (metadata.gate_status !== 'approved') {
                metadata.gate_status = 'approved';
                metadata.gate_failures = 0;
                metadata.gate_last_reason = 'Approved after successful guarded execution.';
                metadata.gate_last_checked_at = new Date().toISOString();
                metadata.updated_at = metadata.gate_last_checked_at;
                this._saveLearnedActionIndex();
            }
            this._registerLearnedActionCommand(normalized, metadata);
            return {
                success: true,
                error_code: 'none',
                message: `Successfully ran learned action "${normalized}".`
            };
        } catch (err) {
            this._recordLearnedActionRun(normalized, false, err?.message || String(err));
            if (metadata.gate_status !== 'approved') {
                metadata.gate_failures = (Number.isFinite(metadata.gate_failures) ? metadata.gate_failures : 0) + 1;
                metadata.gate_last_reason = err?.message || String(err);
                metadata.gate_status = metadata.gate_failures >= 2 ? 'blocked' : 'unverified';
                metadata.gate_last_checked_at = new Date().toISOString();
                metadata.updated_at = metadata.gate_last_checked_at;
                this._saveLearnedActionIndex();
                this._unregisterLearnedActionCommand(normalized);
            }
            return {
                success: false,
                error_code: 'runtime_failed',
                message: `Error running learned action "${normalized}": ${err.message}`
            };
        } finally {
            stack.pop();
        }
    }

    _recordLearnedActionRun(actionName, success, errorMessage = null) {
        const metadata = this._ensureLearnedActionMetadata(actionName, '');
        metadata.runs = (Number.isFinite(metadata.runs) ? metadata.runs : 0) + 1;
        metadata.last_run_at = new Date().toISOString();
        if (success) {
            metadata.successes = (Number.isFinite(metadata.successes) ? metadata.successes : 0) + 1;
            metadata.last_success_at = metadata.last_run_at;
            metadata.last_error = '';
        } else {
            metadata.failures = (Number.isFinite(metadata.failures) ? metadata.failures : 0) + 1;
            metadata.last_failure_at = metadata.last_run_at;
            metadata.last_error = (errorMessage || '').toString();
        }
        metadata.updated_at = metadata.last_run_at;
        this._saveLearnedActionIndex();
    }

    async _lintCode(code) {
        let result = '#### CODE ERROR INFO ###\n';

        // Security checks: block obviously malicious code strings
        const forbidden = ['require', 'process.', 'child_process', 'fs.', 'eval(', 'Function(', '__proto__'];
        for (const word of forbidden) {
            if (code.includes(word)) {
                result += `Security Error: Usage of '${word}' is strictly forbidden in generated code.\n`;
                console.warn(`[Security] Blocked generated code containing: ${word}`);
                return result;
            }
        }

        // Extract everything in the code between the beginning of 'skills./world.' and the '('
        const skillRegex = /(?:skills|world)\.(.*?)\(/g;
        const calledFunctions = [];
        let match;
        while ((match = skillRegex.exec(code)) !== null) {
            calledFunctions.push(match[1]);
        }
        const allDocs = await this.agent.prompter.skill_libary.getAllSkillDocs();
        const availableFunctions = new Set();
        for (const doc of allDocs || []) {
            const docFirstLine = (doc || '').split('\n')[0].trim();
            const fnName = docFirstLine.includes('.') ? docFirstLine.split('.').pop() : docFirstLine;
            if (fnName) {
                availableFunctions.add(fnName);
            }
        }
        // check function exists
        const missingSkills = [...new Set(calledFunctions.filter(skillName => !availableFunctions.has(skillName)))];
        if (missingSkills.length > 0) {
            result += 'These functions do not exist.\n';
            result += '### FUNCTIONS NOT FOUND ###\n';
            result += missingSkills.join('\n');
            console.log(result)
            return result;
        }

        const eslint = new ESLint();
        const results = await eslint.lintText(code);
        const codeLines = code.split('\n');
        const exceptions = results.map(r => r.messages).flat();

        if (exceptions.length > 0) {
            exceptions.forEach((exc, index) => {
                if (exc.line && exc.column) {
                    const errorLine = codeLines[exc.line - 1]?.trim() || 'Unable to retrieve error line content';
                    result += `#ERROR ${index + 1}\n`;
                    result += `Message: ${exc.message}\n`;
                    result += `Location: Line ${exc.line}, Column ${exc.column}\n`;
                    result += `Related Code Line: ${errorLine}\n`;
                }
            });
            result += 'The code contains exceptions and cannot continue execution.';
        } else {
            return null;//no error
        }

        return result;
    }
    // write custom code to file and import it
    // write custom code to file and prepare for evaluation
    async _stageCode(code) {
        code = this._sanitizeCode(code);
        let src = '';

        // Fix common AI hallucination errors
        code = code.replace(/(let|const|var)\s+bot\s*=\s*[^;\n]+;?/g, '');
        code = code.replaceAll('world.log(', 'log(');

        console.log(`Generated code: """${code}"""`);

        // this may cause problems in callback functions
        code = code.replaceAll(';\n', '; if(bot.interrupt_code) {log(bot, "Code interrupted.");return;}\n');
        for (let line of code.split('\n')) {
            src += `    ${line}\n`;
        }
        let src_lint_copy = this.code_lint_template.replace('/* CODE HERE */', src);
        src = this.code_template.replace('/* CODE HERE */', src);

        let filename = this.file_counter + '.js';
        this.file_counter++;

        let write_result = null;
        try {
            write_result = await this._writeFilePromise('.' + this.fp + filename, src);
        } catch (writeErr) {
            console.error('Error writing code execution file:', writeErr);
            return null;
        }

        const customLog = (arg1, arg2) => {
            const b = this.agent.bot;
            if (arg2 !== undefined) {
                skills.log(b, typeof arg2 === 'object' ? JSON.stringify(arg2) : String(arg2));
            } else {
                skills.log(b, typeof arg1 === 'object' ? JSON.stringify(arg1) : String(arg1));
            }
        };

        const compartment = makeCompartment({
            skills,
            log: customLog,
            console: { log: customLog },
            world,
            Vec3,
        });

        if (write_result) {
            console.error('Error writing code execution file:', write_result);
            return null;
        }

        const mainFn = compartment.evaluate(src);
        return { func: { main: mainFn }, src_lint_copy: src_lint_copy };
    }

    _sanitizeCode(code) {
        code = code.trim();
        const remove_strs = ['Javascript', 'javascript', 'js']
        for (let r of remove_strs) {
            if (code.startsWith(r)) {
                code = code.slice(r.length);
                return code;
            }
        }
        return code;
    }

    _writeFilePromise(filename, src) {
        // makes it so we can await this function
        return new Promise((resolve, reject) => {
            writeFile(filename, src, (err) => {
                if (err) {
                    reject(err);
                } else {
                    resolve();
                }
            });
        });
    }
}
