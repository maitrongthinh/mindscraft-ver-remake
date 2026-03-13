/**
 * Wanders and searches the Nether until a Nether Fortress is found. Returns true when a fortress bounding box is entered or its specific blocks are seen.
 */
await skills.log(bot, "Looking for a Nether Fortress...");

if (bot.game.dimension !== 'the_nether') {
    await skills.log(bot, "I am not in the Nether! I need to be in the Nether to find a fortress.");
    return false;
}

// Check nearby blocks for fortress blocks
const fortressBlocks = ['nether_brick', 'nether_brick_fence', 'nether_brick_stairs'];

for (let i = 0; i < 30; i++) { // Search up to 30 times (each scan + wander)
    let blocks = world.getNearbyBlockTypes(bot, 32);
    let found = false;
    for (let fb of fortressBlocks) {
        if (blocks.includes(fb)) {
            await skills.log(bot, `Found fortress blocks (${fb}) nearby! Navigating to it...`);
            let blockPos = world.getNearestBlock(bot, fb, 32);
            if (blockPos) {
                await skills.goToPosition(bot, blockPos.x, blockPos.y, blockPos.z, 2);
                await skills.log(bot, "Arrived at the Nether Fortress!");
                return true;
            }
        }
    }

    // Wander in a random direction if not found
    await skills.log(bot, "Fortress not found yet, wandering further...");
    let wanderZ = bot.entity.position.z + (Math.random() > 0.5 ? 40 : -40);
    let wanderX = bot.entity.position.x + (Math.random() > 0.5 ? 40 : -40);
    // Don't wait for the wander to fully complete if it's too far, just move towards it
    await skills.goToPosition(bot, wanderX, bot.entity.position.y, wanderZ, 4);
}

await skills.log(bot, "Could not find a Nether Fortress after extensive searching.");
return false;
