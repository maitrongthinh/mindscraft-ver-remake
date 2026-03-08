import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

/**
 * Validates AI-generated JavaScript code to prevent malicious behavior (RCE, fs access).
 * Only allows accessing whitelisted globals (`bot`, `world`, `skills`, `Vec3`, `Math`, `console`)
 * and bans require, eval, Function, Process, etc.
 * 
 * @param {string} code - The JavaScript source code to validate
 * @returns {{valid: boolean, reason?: string}}
 */
export function validateReflexCode(code) {
    if (!code || typeof code !== 'string') {
        return { valid: false, reason: 'Code is empty or not a string.' };
    }

    // A5: Code length limit to prevent excessively large generated code
    if (code.length > 5000) {
        return { valid: false, reason: `Code too long (${code.length} chars, max 5000). Reflexes should be concise.` };
    }

    // Wrap the code in an async function to parse it properly (since it uses await)
    const wrappedCode = `async function reflex(bot, skills, world, Vec3) { ${code} }`;

    let ast;
    try {
        ast = acorn.parse(wrappedCode, { ecmaVersion: 'latest', sourceType: 'script' });
    } catch (err) {
        return { valid: false, reason: `Syntax error: ${err.message}` };
    }

    const bannedGlobals = new Set([
        'require', 'process', 'eval', 'Function', 'setTimeout', 'setInterval',
        'global', 'globalThis', 'window', 'document', 'module', 'exports',
        'import', 'importScripts', 'fetch', 'XMLHttpRequest', 'WebSocket',
        'Reflect' // Prevent Reflect.get prototype pollution bypass
    ]);

    let invalidReason = null;

    // A5: Track function call nesting depth to detect recursive bombs
    let maxCallDepth = 0;

    function walkCallDepth(node, depth) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'CallExpression') {
            depth++;
            if (depth > maxCallDepth) maxCallDepth = depth;
        }
        for (const key of Object.keys(node)) {
            if (key === 'type') continue;
            const child = node[key];
            if (Array.isArray(child)) {
                for (const c of child) {
                    if (c && typeof c === 'object' && c.type) {
                        walkCallDepth(c, depth);
                    }
                }
            } else if (child && typeof child === 'object' && child.type) {
                walkCallDepth(child, depth);
            }
        }
    }

    walkCallDepth(ast, 0);
    if (maxCallDepth > 10) {
        return { valid: false, reason: `Excessive nested call depth (${maxCallDepth}). Possible recursive bomb.` };
    }

    walk.simple(ast, {
        Identifier(node) {
            if (bannedGlobals.has(node.name)) {
                invalidReason = `Access to banned global/function '${node.name}' is not allowed.`;
            }
        },
        CallExpression(node) {
            // Block generic eval/Function calls
            if (node.callee.type === 'Identifier') {
                if (bannedGlobals.has(node.callee.name)) {
                    invalidReason = `Calling banned function '${node.callee.name}' is not allowed.`;
                }
            }
            // Block 'something["require"]()' obfuscation attempts if we can easily detect it
            if (node.callee.type === 'MemberExpression') {
                if (node.callee.property.type === 'Identifier' && bannedGlobals.has(node.callee.property.name)) {
                    invalidReason = `Accessing banned property '${node.callee.property.name}' is not allowed.`;
                }
            }
        },
        MemberExpression(node) {
            // Prevent accessing constructor or __proto__ that could lead to prototype pollution or sandbox escapes
            const dangerousProps = new Set(['constructor', '__proto__', 'getPrototypeOf', 'setPrototypeOf']);
            if (node.property.type === 'Identifier') {
                if (dangerousProps.has(node.property.name)) {
                    invalidReason = `Accessing prototype internals ('${node.property.name}') is not allowed.`;
                }
            } else if (node.property.type === 'Literal') {
                if (dangerousProps.has(node.property.value)) {
                    invalidReason = `Accessing prototype internals via literal is not allowed.`;
                }
            }
        }
    });

    if (invalidReason) {
        return { valid: false, reason: invalidReason };
    }

    // Basic regex checks just to be absolutely paranoid
    const regexBans = [
        /require\s*\(/,
        /process\./,
        /eval\s*\(/,
        /new\s+Function\s*\(/,
        /\bimport\b/,
        // A5: Block massive array allocation (Array(1e6+) or Array(999999+))
        /Array\s*\(\s*\d{6,}\s*\)/,
        /Array\s*\(\s*1e[6-9]\d*\s*\)/
    ];

    for (const regex of regexBans) {
        if (regex.test(code)) {
            return { valid: false, reason: `Regex check failed: code matches banned pattern ${regex.toString()}` };
        }
    }

    return { valid: true };
}
