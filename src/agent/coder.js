import { writeFile, readFile, mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { makeCompartment, lockdown } from './library/lockdown.js';
import * as skills from './library/skills.js';
import * as world from './library/world.js';
import { Vec3 } from 'vec3';
import { ESLint } from "eslint";

export class Coder {
    constructor(agent) {
        this.agent = agent;
        this.file_counter = 0;
        this.fp = '/bots/' + agent.name + '/action-code/';

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
    }

    async generateCode(agent_history) {
        this.agent.bot.modes.pause('unstuck');
        lockdown();
        // this message history is transient and only maintained in this function
        let messages = agent_history.getHistory();
        messages.push({ role: 'system', content: 'Code generation started. Write code in codeblock in your response:' });

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
            const messages_copy = structuredClone(messages);
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