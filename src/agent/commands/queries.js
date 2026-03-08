import * as world from '../library/world.js';
import * as mc from '../../utils/mcdata.js';
import { getCommandDocs } from './index.js';
import convoManager from '../conversation.js';
import { checkLevelBlueprint, checkBlueprint } from '../tasks/construction_tasks.js';
import { load } from 'cheerio';

// Cache for !searchWiki results (10 minutes TTL)
const _wikiCache = new Map();
const WIKI_CACHE_TTL_MS = 600000;
const WIKI_FETCH_TIMEOUT_MS = 5000;

const pad = (str) => {
    return '\n' + str + '\n';
}

const MAX_NEARBY_BLOCK_SCAN = 160;
const MAX_NEARBY_BLOCK_TYPES = 30;
const MAX_ENTITY_TYPE_LINES = 12;

// queries are commands that just return strings and don't affect anything in the world
export const queryList = [
    {
        name: "!stats",
        description: "Get your bot's location, health, hunger, and time of day.",
        perform: function (agent) {
            let bot = agent.bot;
            let res = 'STATS';
            let pos = bot.entity.position;
            // display position to 2 decimal places
            res += `\n- Position: x: ${pos.x.toFixed(2)}, y: ${pos.y.toFixed(2)}, z: ${pos.z.toFixed(2)}`;
            // Gameplay
            res += `\n- Gamemode: ${bot.game.gameMode}`;
            res += `\n- Health: ${Math.round(bot.health)} / 20`;
            res += `\n- Hunger: ${Math.round(bot.food)} / 20`;
            res += `\n- Biome: ${world.getBiomeName(bot)}`;
            let weather = "Clear";
            if (bot.rainState > 0)
                weather = "Rain";
            if (bot.thunderState > 0)
                weather = "Thunderstorm";
            res += `\n- Weather: ${weather}`;
            // let block = bot.blockAt(pos);
            // res += `\n- Artficial light: ${block.skyLight}`;
            // res += `\n- Sky light: ${block.light}`;
            // light properties are bugged, they are not accurate


            if (bot.time.timeOfDay < 6000) {
                res += '\n- Time: Morning';
            } else if (bot.time.timeOfDay < 12000) {
                res += '\n- Time: Afternoon';
            } else {
                res += '\n- Time: Night';
            }

            // get the bot's current action
            let action = agent.actions.currentActionLabel;
            if (agent.isIdle())
                action = 'Idle';
            res += `\n- Current Action: ${action}`;


            let players = world.getNearbyPlayerNames(bot);
            let bots = convoManager.getInGameAgents().filter(b => b !== agent.name);
            players = players.filter(p => !bots.includes(p));

            res += '\n- Nearby Human Players: ' + (players.length > 0 ? players.join(', ') : 'None.');
            res += '\n- Nearby Bot Players: ' + (bots.length > 0 ? bots.join(', ') : 'None.');

            res += '\n' + agent.bot.modes.getMiniDocs() + '\n';
            return pad(res);
        }
    },
    {
        name: "!debugState",
        description: "Get a concise runtime debug snapshot: action state, long-term goal, safety threats, and learned-action recommendations.",
        perform: function (agent) {
            return pad(agent.getDebugStateReport());
        }
    },
    {
        name: "!inventory",
        description: "Get your bot's inventory.",
        perform: function (agent) {
            let bot = agent.bot;
            let inventory = world.getInventoryCounts(bot);
            let res = 'INVENTORY';
            for (const item in inventory) {
                if (inventory[item] && inventory[item] > 0)
                    res += `\n- ${item}: ${inventory[item]}`;
            }
            if (res === 'INVENTORY') {
                res += ': Nothing';
            }
            else if (agent.bot.game.gameMode === 'creative') {
                res += '\n(You have infinite items in creative mode. You do not need to gather resources!!)';
            }

            let helmet = bot.inventory.slots[5];
            let chestplate = bot.inventory.slots[6];
            let leggings = bot.inventory.slots[7];
            let boots = bot.inventory.slots[8];
            res += '\nWEARING: ';
            if (helmet)
                res += `\nHead: ${helmet.name}`;
            if (chestplate)
                res += `\nTorso: ${chestplate.name}`;
            if (leggings)
                res += `\nLegs: ${leggings.name}`;
            if (boots)
                res += `\nFeet: ${boots.name}`;
            if (!helmet && !chestplate && !leggings && !boots)
                res += 'Nothing';

            return pad(res);
        }
    },
    {
        name: "!nearbyBlocks",
        description: "Get the blocks near the bot.",
        perform: function (agent) {
            let bot = agent.bot;
            let res = 'NEARBY_BLOCKS';
            let blocks = world.getNearestBlocks(bot, null, 10, MAX_NEARBY_BLOCK_SCAN);
            let block_details = new Set();

            for (let block of blocks) {
                let details = block.name;
                if (block.name === 'water' || block.name === 'lava') {
                    details += block.metadata === 0 ? ' (source)' : ' (flowing)';
                }
                block_details.add(details);
                if (block_details.size >= MAX_NEARBY_BLOCK_TYPES) {
                    break;
                }
            }
            for (let details of block_details) {
                res += `\n- ${details}`;
            }
            if (block_details.size === 0) {
                res += ': none';
            }
            else {
                res += '\n- ' + world.getSurroundingBlocks(bot).join('\n- ');
                res += `\n- First Solid Block Above Head: ${world.getFirstBlockAboveHead(bot, null, 32)}`;
                if (blocks.length >= MAX_NEARBY_BLOCK_SCAN) {
                    res += '\n- (Nearby block list truncated for speed.)';
                }
            }
            return pad(res);
        }
    },
    {
        name: "!craftable",
        description: "Get the craftable items with the bot's inventory.",
        perform: function (agent) {
            let craftable = world.getCraftableItems(agent.bot);
            let res = 'CRAFTABLE_ITEMS';
            for (const item of craftable) {
                res += `\n- ${item}`;
            }
            if (res == 'CRAFTABLE_ITEMS') {
                res += ': none';
            }
            return pad(res);
        }
    },
    {
        name: "!entities",
        description: "Get the nearby players and entities.",
        perform: function (agent) {
            let bot = agent.bot;
            let res = 'NEARBY_ENTITIES';
            let bots = convoManager.getInGameAgents().filter(b => b !== agent.name);
            const nearbyPlayers = world.getNearbyPlayers(bot, 64);
            for (const playerEntity of nearbyPlayers) {
                const pos = playerEntity.position;
                const dist = bot.entity.position.distanceTo(pos);
                const playerLine = `@ x:${pos.x.toFixed(1)}, y:${pos.y.toFixed(1)}, z:${pos.z.toFixed(1)} (d:${dist.toFixed(1)})`;
                if (bots.includes(playerEntity.username)) {
                    res += `\n- Bot player: ${playerEntity.username} ${playerLine}`;
                } else {
                    res += `\n- Human player: ${playerEntity.username} ${playerLine}`;
                }
            }

            let nearbyEntities = world.getNearbyEntities(bot);
            let entityStats = {};
            let villagerIds = [];
            let babyVillagerIds = [];
            let villagerDetails = []; // Store detailed villager info including profession
            let droppedItemCount = 0;
            let nearestDroppedItem = null;
            let nearestDroppedItemDist = Infinity;

            for (const entity of nearbyEntities) {
                if (entity.type === 'player')
                    continue;

                const dist = entity.position.distanceTo(bot.entity.position);
                if (entity.name === 'item') {
                    droppedItemCount++;
                    if (dist < nearestDroppedItemDist) {
                        nearestDroppedItemDist = dist;
                        nearestDroppedItem = entity;
                    }
                    continue;
                }

                if (!entityStats[entity.name]) {
                    entityStats[entity.name] = {
                        count: 0,
                        nearestDistance: dist,
                        nearestPosition: entity.position
                    };
                }
                entityStats[entity.name].count++;
                if (dist < entityStats[entity.name].nearestDistance) {
                    entityStats[entity.name].nearestDistance = dist;
                    entityStats[entity.name].nearestPosition = entity.position;
                }

                if (entity.name === 'villager') {
                    if (entity.metadata && entity.metadata[16] === 1) {
                        babyVillagerIds.push(entity.id);
                    } else {
                        const profession = world.getVillagerProfession(entity);
                        villagerIds.push(entity.id);
                        villagerDetails.push({
                            id: entity.id,
                            profession: profession
                        });
                    }
                }
            }

            const entityEntries = Object.entries(entityStats)
                .sort((a, b) => a[1].nearestDistance - b[1].nearestDistance)
                .slice(0, MAX_ENTITY_TYPE_LINES);

            for (const [entityType, stats] of entityEntries) {
                const pos = stats.nearestPosition;
                const nearestText = `nearest @ x:${pos.x.toFixed(1)}, y:${pos.y.toFixed(1)}, z:${pos.z.toFixed(1)} (d:${stats.nearestDistance.toFixed(1)})`;
                if (entityType === 'villager') {
                    let villagerInfo = `${stats.count} ${entityType}(s), ${nearestText}`;
                    if (villagerDetails.length > 0) {
                        const detailStrings = villagerDetails.map(v => `(${v.id}:${v.profession})`);
                        villagerInfo += ` - Adults: ${detailStrings.join(', ')}`;
                    }
                    if (babyVillagerIds.length > 0) {
                        villagerInfo += ` - Baby IDs: ${babyVillagerIds.join(', ')} (babies cannot trade)`;
                    }
                    res += `\n- entities: ${villagerInfo}`;
                } else {
                    res += `\n- entities: ${stats.count} ${entityType}(s), ${nearestText}`;
                }
            }

            if (Object.keys(entityStats).length > MAX_ENTITY_TYPE_LINES) {
                const hiddenCount = Object.keys(entityStats).length - MAX_ENTITY_TYPE_LINES;
                res += `\n- entities: ${hiddenCount} more entity type(s) hidden for brevity`;
            }

            if (droppedItemCount > 0 && nearestDroppedItem) {
                const pos = nearestDroppedItem.position;
                res += `\n- dropped_items: ${droppedItemCount}, nearest @ x:${pos.x.toFixed(1)}, y:${pos.y.toFixed(1)}, z:${pos.z.toFixed(1)} (d:${nearestDroppedItemDist.toFixed(1)})`;
            }

            if (res == 'NEARBY_ENTITIES') {
                res += ': none';
            }
            return pad(res);
        }
    },
    {
        name: "!modes",
        description: "Get all available modes and their docs and see which are on/off.",
        perform: function (agent) {
            return agent.bot.modes.getDocs();
        }
    },
    {
        name: '!savedPlaces',
        description: 'List all saved locations.',
        perform: async function (agent) {
            return "Saved place names: " + agent.memory_bank.getKeys();
        }
    },
    {
        name: '!checkBlueprintLevel',
        description: 'Check if the level is complete and what blocks still need to be placed for the blueprint',
        params: {
            'levelNum': { type: 'int', description: 'The level number to check.', domain: [0, Number.MAX_SAFE_INTEGER] }
        },
        perform: function (agent, levelNum) {
            let res = checkLevelBlueprint(agent, levelNum);
            console.log(res);
            return pad(res);
        }
    },
    {
        name: '!checkBlueprint',
        description: 'Check what blocks still need to be placed for the blueprint',
        perform: function (agent) {
            let res = checkBlueprint(agent);
            return pad(res);
        }
    },
    {
        name: '!getBlueprint',
        description: 'Get the blueprint for the building',
        perform: function (agent) {
            let res = agent.task.blueprint.explain();
            return pad(res);
        }
    },
    {
        name: '!getBlueprintLevel',
        description: 'Get the blueprint for the building',
        params: {
            'levelNum': { type: 'int', description: 'The level number to check.', domain: [0, Number.MAX_SAFE_INTEGER] }
        },
        perform: function (agent, levelNum) {
            let res = agent.task.blueprint.explainLevel(levelNum);
            console.log(res);
            return pad(res);
        }
    },
    {
        name: '!getCraftingPlan',
        description: "Provides a comprehensive crafting plan for a specified item. This includes a breakdown of required ingredients, the exact quantities needed, and an analysis of missing ingredients or extra items needed based on the bot's current inventory.",
        params: {
            targetItem: {
                type: 'string',
                description: 'The item that we are trying to craft'
            },
            quantity: {
                type: 'int',
                description: 'The quantity of the item that we are trying to craft',
                optional: true,
                domain: [1, Infinity, '[)'], // Quantity must be at least 1,
                default: 1
            }
        },
        perform: function (agent, targetItem, quantity = 1) {
            let bot = agent.bot;

            // Fetch the bot's inventory
            const curr_inventory = world.getInventoryCounts(bot);
            const target_item = targetItem;
            let existingCount = curr_inventory[target_item] || 0;
            let prefixMessage = '';
            if (existingCount > 0) {
                curr_inventory[target_item] -= existingCount;
                prefixMessage = `You already have ${existingCount} ${target_item} in your inventory. If you need to craft more,\n`;
            }

            // Generate crafting plan
            try {
                let craftingPlan = mc.getDetailedCraftingPlan(target_item, quantity, curr_inventory);
                craftingPlan = prefixMessage + craftingPlan;
                return pad(craftingPlan);
            } catch (error) {
                console.error("Error generating crafting plan:", error);
                return `An error occurred while generating the crafting plan: ${error.message}`;
            }


        },
    },
    {
        name: '!searchWiki',
        description: 'Search the Minecraft Wiki for the given query.',
        params: {
            'query': { type: 'string', description: 'The query to search for.' }
        },
        perform: async function (agent, query) {
            // Check cache first
            const cached = _wikiCache.get(query);
            if (cached && Date.now() - cached.ts < WIKI_CACHE_TTL_MS) {
                return cached.result;
            }

            const url = `https://minecraft.wiki/w/${query}`;
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), WIKI_FETCH_TIMEOUT_MS);
            try {
                const response = await fetch(url, { signal: controller.signal });
                clearTimeout(timeoutId);
                if (response.status === 404) {
                    return `${query} was not found on the Minecraft Wiki. Try adjusting your search term.`;
                }
                const html = await response.text();
                const $ = load(html);

                const parserOutput = $("div.mw-parser-output");
                parserOutput.find("table.navbox").remove();
                let divContent = parserOutput.text().trim();

                // Fix 2.8: Truncate to save API context window and memory limits
                if (divContent.length > 2000) {
                    divContent = divContent.substring(0, 2000) + '... (truncated for brevity)';
                }

                _wikiCache.set(query, { result: divContent, ts: Date.now() });
                return divContent;
            } catch (error) {
                clearTimeout(timeoutId);
                if (error.name === 'AbortError') {
                    return `Search timed out after ${WIKI_FETCH_TIMEOUT_MS / 1000}s. The Minecraft Wiki may be unavailable.`;
                }
                console.error('Error fetching or parsing wiki HTML:', error);
                return `The following error occurred: ${error.message}`;
            }
        }
    },
    {
        name: '!help',
        description: 'Lists all available commands and their descriptions.',
        perform: async function (agent) {
            return getCommandDocs(agent);
        }
    },
    {
        name: '!askMemory',
        description: 'Search spatial memory for the nearest remembered location of a block type (e.g. diamond_ore, chest, iron_ore).',
        params: {
            'query': { type: 'string', description: 'Block type to search for (e.g. "diamond", "chest", "iron").' }
        },
        perform: function (agent, query) {
            if (!query) {
                return 'Please provide a block type to search for. Example: !askMemory("diamond")';
            }
            const pos = agent.bot.entity.position;
            if (!pos) {
                return 'Cannot search: bot position unavailable.';
            }
            const dimension = agent.bot.game.dimension;
            // Proximity verification: clean stale entries near bot before querying
            const removed = agent.memory_bank.verifyAndClean(agent.bot, query, pos, 5, dimension);
            if (removed > 0) {
                agent.memory_bank.saveSpatialMemory();
            }
            return agent.memory_bank.findNearest(query, pos, dimension);
        }
    },
    {
        name: '!learnReflexes',
        description: 'Command the bot to analyze its recent damage logs and automatically write a JavaScript reflex handler to protect itself. Requires enough data (at least 3 damage events).',
        perform: async function (agent) {
            return await agent.reflex_architect.learnFromDamage();
        }
    },
    {
        name: '!clearReflexes',
        description: 'Clear the currently loaded reflex handler and all recent damage logs.',
        perform: function (agent) {
            agent.damage_logger.clearLogs();
            if (agent.reflex_loader?.activeReflexHandlers) {
                agent.reflex_loader.activeReflexHandlers.clear();
            }
            return 'Reflexes and damage logs cleared.';
        }
    },
];
