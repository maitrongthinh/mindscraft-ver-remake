import { getBlockId, getItemId } from "../../utils/mcdata.js";
import { actionsList } from './actions.js';
import { queryList } from './queries.js';

let suppressNoDomainWarning = true;

let commandList = queryList.concat(actionsList);
const commandMap = {};
for (let command of commandList) {
    commandMap[command.name] = command;
}

export function getCommand(name) {
    return commandMap[name];
}

export function blacklistCommands(commands) {
    const unblockable = ['!stop', '!stats', '!inventory', '!goal'];
    for (let command_name of commands) {
        if (unblockable.includes(command_name)) {
            console.warn(`Command ${command_name} is unblockable`);
            continue;
        }
        delete commandMap[command_name];
        commandList = commandList.filter(command => command.name !== command_name);
    }
}

const commandNameRegex = /!([a-zA-Z0-9_]+)/;

function findPreferredCommandMatch(message) {
    const lineCommandRegex = /(?:^|[\r\n])[ \t]*!([a-zA-Z0-9_]+)/g;
    const lineMatch = lineCommandRegex.exec(message);
    if (lineMatch) {
        const fullMatch = lineMatch[0];
        const bangOffset = fullMatch.lastIndexOf('!');
        return {
            index: lineMatch.index + bangOffset,
            name: lineMatch[1]
        };
    }

    const inlineMatch = commandNameRegex.exec(message);
    if (!inlineMatch) return null;
    return {
        index: inlineMatch.index,
        name: inlineMatch[1]
    };
}

function findLineEnd(text, fromIndex) {
    let end = text.length;
    const newlineIndex = text.indexOf('\n', fromIndex);
    const carriageIndex = text.indexOf('\r', fromIndex);
    if (newlineIndex !== -1) {
        end = Math.min(end, newlineIndex);
    }
    if (carriageIndex !== -1) {
        end = Math.min(end, carriageIndex);
    }
    return end;
}

function parseCommaSeparatedArgs(text) {
    const args = [];
    let current = '';
    let quote = null;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (quote) {
            current += char;
            if (char === quote && text[i - 1] !== '\\') {
                quote = null;
            }
            continue;
        }
        if (char === '"' || char === "'") {
            quote = char;
            current += char;
            continue;
        }
        if (char === ',') {
            const token = current.trim();
            if (!token) return null;
            args.push(token);
            current = '';
            continue;
        }
        current += char;
    }

    if (quote) return null;
    const token = current.trim();
    if (!token) return null;
    args.push(token);
    return args;
}

function parseSpaceSeparatedArgs(text) {
    const args = [];
    let index = 0;

    while (index < text.length) {
        while (index < text.length && /\s/.test(text[index])) {
            index += 1;
        }
        if (index >= text.length) break;

        const start = index;
        if (text[index] === '"' || text[index] === "'") {
            const quote = text[index];
            index += 1;
            while (index < text.length) {
                if (text[index] === quote && text[index - 1] !== '\\') {
                    index += 1;
                    break;
                }
                index += 1;
            }
            if (text[index - 1] !== quote) {
                return null;
            }
        } else {
            while (index < text.length && !/\s/.test(text[index])) {
                index += 1;
            }
        }

        const token = text.substring(start, index).trim();
        if (!token) return null;
        args.push(token);
    }

    return { args, consumed: index };
}

function parseCommandInvocation(message) {
    if (typeof message !== 'string') return null;

    const commandMatch = findPreferredCommandMatch(message);
    if (!commandMatch) return null;

    const commandName = "!" + commandMatch.name;
    const commandStart = commandMatch.index;
    const baseEnd = commandStart + commandName.length;
    let commandEnd = baseEnd;
    let parseError = null;
    let rawArgs = [];

    let cursor = baseEnd;
    while (cursor < message.length && (message[cursor] === ' ' || message[cursor] === '\t')) {
        cursor += 1;
    }

    if (cursor < message.length && message[cursor] === '(') {
        let closeParen = -1;
        let quote = null;
        for (let i = cursor + 1; i < message.length; i++) {
            const char = message[i];
            if (quote) {
                if (char === quote && message[i - 1] !== '\\') {
                    quote = null;
                }
                continue;
            }
            if (char === '"' || char === "'") {
                quote = char;
                continue;
            }
            if (char === ')') {
                closeParen = i;
                break;
            }
        }

        if (closeParen === -1) {
            parseError = 'Command is incorrectly formatted';
        } else {
            const argText = message.substring(cursor + 1, closeParen).trim();
            if (argText.length > 0) {
                const parsed = parseCommaSeparatedArgs(argText);
                if (!parsed) {
                    parseError = 'Command is incorrectly formatted';
                } else {
                    rawArgs = parsed;
                }
            }
            commandEnd = closeParen + 1;
        }
    } else if (cursor > baseEnd && cursor < message.length && message[cursor] !== '\n' && message[cursor] !== '\r') {
        const lineEnd = findLineEnd(message, cursor);
        const parsed = parseSpaceSeparatedArgs(message.substring(cursor, lineEnd));
        if (!parsed) {
            parseError = 'Command is incorrectly formatted';
        } else {
            rawArgs = parsed.args;
            commandEnd = cursor + parsed.consumed;
            while (commandEnd > baseEnd && /\s/.test(message[commandEnd - 1])) {
                commandEnd -= 1;
            }
            if (rawArgs.length === 0) {
                commandEnd = baseEnd;
            }
        }
    }

    return {
        commandName,
        commandStart,
        commandEnd,
        rawArgs,
        parseError
    };
}

export function containsCommand(message) {
    const parsed = parseCommandInvocation(message);
    if (parsed)
        return parsed.commandName;
    return null;
}

export function commandExists(commandName) {
    if (!commandName.startsWith("!"))
        commandName = "!" + commandName;
    return commandMap[commandName] !== undefined;
}

/**
 * Converts a string into a boolean.
 * @param {string} input
 * @returns {boolean | null} the boolean or `null` if it could not be parsed.
 * */
function parseBoolean(input) {
    switch (input.toLowerCase()) {
        case 'false': //These are interpreted as flase;
        case 'f':
        case '0':
        case 'off':
            return false;
        case 'true': //These are interpreted as true;
        case 't':
        case '1':
        case 'on':
            return true;
        default:
            return null;
    }
}

function normalizeCommonName(arg, paramType) {
    if (typeof arg !== 'string') {
        return arg;
    }
    return arg.trim().toLowerCase().replaceAll(' ', '_');
}

/**
 * @param {number} value - the value to check
 * @param {number} lowerBound
 * @param {number} upperBound
 * @param {string} endpointType - The type of the endpoints represented as a two character string. `'[)'` `'()'` 
 */
function checkInInterval(number, lowerBound, upperBound, endpointType) {
    switch (endpointType) {
        case '[)':
            return lowerBound <= number && number < upperBound;
        case '()':
            return lowerBound < number && number < upperBound;
        case '(]':
            return lowerBound < number && number <= upperBound;
        case '[]':
            return lowerBound <= number && number <= upperBound;
        default:
            throw new Error('Unknown endpoint type:', endpointType)
    }
}



// todo: handle arrays?
/**
 * Returns an object containing the command, the command name, and the comand parameters.
 * If parsing unsuccessful, returns an error message as a string.
 * @param {string} message - A message from a player or language model containing a command.
 * @returns {string | Object}
 */
export function parseCommandMessage(message) {
    const parsed = parseCommandInvocation(message);
    if (!parsed) return `Command is incorrectly formatted`;
    if (parsed.parseError) return parsed.parseError;

    const commandName = parsed.commandName;
    const args = parsed.rawArgs;

    const command = getCommand(commandName);
    if (!command) return `${commandName} is not a command.`

    const params = commandParams(command);
    const paramNames = commandParamNames(command);
    const requiredParams = params.filter(param => !param.optional).length;
    if (args.length < requiredParams || args.length > params.length) {
        if (requiredParams === params.length) {
            return `Command ${command.name} was given ${args.length} args, but requires ${params.length} args.`;
        }
        return `Command ${command.name} was given ${args.length} args, but requires ${requiredParams} to ${params.length} args.`;
    }

    const normalizedArgs = [];
    for (let i = 0; i < params.length; i++) {
        const param = params[i];
        let arg = args[i];
        if (arg === undefined) {
            if (param.optional) {
                normalizedArgs[i] = param.default;
                continue;
            }
            return `Error: Missing required param '${paramNames[i]}'.`;
        }

        //Remove any extra characters
        arg = arg.trim();
        if ((arg.startsWith('"') && arg.endsWith('"')) || (arg.startsWith("'") && arg.endsWith("'"))) {
            arg = arg.substring(1, arg.length - 1);
        }

        //Convert to the correct type
        switch (param.type) {
            case 'int':
                arg = Number.parseInt(arg); break;
            case 'float':
                arg = Number.parseFloat(arg); break;
            case 'boolean':
                arg = parseBoolean(arg); break;
            case 'BlockName':
            case 'BlockOrItemName':
            case 'ItemName':
                arg = normalizeCommonName(arg, param.type);
                if (arg.endsWith('plank') || arg.endsWith('seed'))
                    arg += 's'; // add 's' to for common mistakes like "oak_plank" or "wheat_seed"
                break; // BUG L3 Fix: prevent case fallthrough
            case 'string':
                break;
            default:
                throw new Error(`Command '${commandName}' parameter '${paramNames[i]}' has an unknown type: ${param.type}`);
        }
        if (arg === null || Number.isNaN(arg))
            return `Error: Param '${paramNames[i]}' must be of type ${param.type}.`

        if (typeof arg === 'number') { //Check the domain of numbers
            const domain = param.domain;
            if (domain) {
                /**
                 * Javascript has a built in object for sets but not intervals.
                 * Currently the interval (lowerbound,upperbound] is represented as an Array: `[lowerbound, upperbound, '(]']`
                 */
                if (!domain[2]) domain[2] = '[)'; //By default, lower bound is included. Upper is not.

                if (!checkInInterval(arg, ...domain)) {
                    return `Error: Param '${paramNames[i]}' must be an element of ${domain[2][0]}${domain[0]}, ${domain[1]}${domain[2][1]}.`;
                    //Alternatively arg could be set to the nearest value in the domain.
                }
            } else if (!suppressNoDomainWarning) {
                console.warn(`Command '${commandName}' parameter '${paramNames[i]}' has no domain set. Expect any value [-Infinity, Infinity].`)
                suppressNoDomainWarning = true; //Don't spam console. Only give the warning once.
            }
        } else if (param.type === 'BlockName') { //Check that there is a block with this name
            if (getBlockId(arg) == null) return `Invalid block type: ${arg}.`
        } else if (param.type === 'ItemName') { //Check that there is an item with this name
            if (getItemId(arg) == null) return `Invalid item type: ${arg}.`
        } else if (param.type === 'BlockOrItemName') {
            if (getBlockId(arg) == null && getItemId(arg) == null) return `Invalid block or item type: ${arg}.`
        }
        normalizedArgs[i] = arg;
    }

    return { commandName, args: normalizedArgs };
}

export function truncCommandMessage(message) {
    const parsed = parseCommandInvocation(message);
    if (parsed) {
        return message.substring(0, parsed.commandEnd);
    }
    return message;
}

export function isAction(name) {
    return actionsList.find(action => action.name === name) !== undefined;
}

/**
 * @param {Object} command
 * @returns {Object[]} The command's parameters.
 */
function commandParams(command) {
    if (!command.params)
        return [];
    return Object.values(command.params);
}

/**
 * @param {Object} command
 * @returns {string[]} The names of the command's parameters.
 */
function commandParamNames(command) {
    if (!command.params)
        return [];
    return Object.keys(command.params);
}

function numParams(command) {
    return commandParams(command).length;
}

export async function executeCommand(agent, message) {
    let parsed = parseCommandMessage(message);
    if (typeof parsed === 'string')
        return parsed; //The command was incorrectly formatted or an invalid input was given.
    else {
        console.log('parsed command:', parsed);
        const command = getCommand(parsed.commandName);
        let numArgs = 0;
        if (parsed.args) {
            numArgs = parsed.args.length;
        }
        let requiredParams = 0;
        for (const [key, param] of Object.entries(command.params || {})) {
            if (!param.optional) requiredParams++;
        }

        if (numArgs < requiredParams || numArgs > numParams(command))
            return `Command ${command.name} was given ${numArgs} args, but requires between ${requiredParams} and ${numParams(command)} args.`;
        else {
            const result = await command.perform(agent, ...parsed.args);
            return result;
        }
    }
}

export function getCommandDocs(agent, options = {}) {
    const typeTranslations = {
        //This was added to keep the prompt the same as before type checks were implemented.
        //If the language model is giving invalid inputs changing this might help.
        'float': 'number',
        'int': 'number',
        'BlockName': 'string',
        'ItemName': 'string',
        'BlockOrItemName': 'string',
        'boolean': 'bool'
    }
    const compact = Boolean(options.compact);
    const maxEntries = Number.isFinite(options.maxEntries) && options.maxEntries > 0 ? Math.floor(options.maxEntries) : -1;
    const visibleCommands = commandList.filter(command => !agent.blocked_actions.includes(command.name));
    const listedCommands = maxEntries === -1 ? visibleCommands : visibleCommands.slice(0, maxEntries);

    let docs = `\n*COMMAND DOCS\n You can use the following commands to perform actions and get information about the world. 
    Use the commands with the syntax: !commandName, !commandName arg1 arg2, or !commandName("arg1", 1.2, ...) if the command takes arguments.\n
    Do not use codeblocks. Use double quotes for strings. Only use one command in each response, trailing commands and comments will be ignored.\n`;

    for (let command of listedCommands) {
        if (!compact) {
            docs += command.name + ': ' + command.description + '\n';
            if (command.params) {
                docs += 'Params:\n';
                for (let param in command.params) {
                    docs += `${param}: (${typeTranslations[command.params[param].type] ?? command.params[param].type}) ${command.params[param].description}\n`;
                }
            }
        } else {
            docs += command.name + ': ' + command.description;
            if (command.params) {
                const compactParams = [];
                for (let param in command.params) {
                    compactParams.push(`${param}:${typeTranslations[command.params[param].type] ?? command.params[param].type}`);
                }
                if (compactParams.length > 0) {
                    docs += ` | Params: ${compactParams.join(', ')}`;
                }
            }
            docs += '\n';
        }
    }

    if (listedCommands.length < visibleCommands.length) {
        const hidden = visibleCommands.length - listedCommands.length;
        docs += `... ${hidden} more commands hidden to keep context short. Use !help for the full list.\n`;
    }

    return docs + '*\n';
}

function isValidCommandName(commandName) {
    return typeof commandName === 'string' && /^![a-zA-Z0-9_]+$/.test(commandName);
}

function normalizeCommandName(commandName) {
    if (typeof commandName !== 'string') {
        return '';
    }
    const trimmed = commandName.trim();
    if (!trimmed) {
        return '';
    }
    return trimmed.startsWith('!') ? trimmed : `!${trimmed}`;
}

export function registerCommand(command, options = {}) {
    const replace = options?.replace === true;
    if (!command || typeof command !== 'object') {
        return {
            success: false,
            message: 'Command registration failed: command must be an object.'
        };
    }
    if (!isValidCommandName(command.name)) {
        return {
            success: false,
            message: `Command registration failed: invalid command name "${command.name}".`
        };
    }
    if (typeof command.perform !== 'function') {
        return {
            success: false,
            message: `Command registration failed: "${command.name}" is missing perform().`
        };
    }

    const existing = commandMap[command.name];
    if (existing && !replace) {
        return {
            success: false,
            message: `Command registration failed: "${command.name}" already exists.`
        };
    }

    if (existing) {
        commandList = commandList.filter(c => c.name !== command.name);
    }
    commandList.push(command);
    commandMap[command.name] = command;
    return {
        success: true,
        message: `Registered command "${command.name}".`
    };
}

export function unregisterCommand(commandName) {
    const normalized = normalizeCommandName(commandName);
    if (!isValidCommandName(normalized)) {
        return false;
    }
    if (!commandMap[normalized]) {
        return false;
    }
    delete commandMap[normalized];
    commandList = commandList.filter(c => c.name !== normalized);
    return true;
}
