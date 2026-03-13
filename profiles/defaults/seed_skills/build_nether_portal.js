/**
 * Builds and ignites a Nether Portal near the bot's current location. Requires exactly 10 obsidian blocks and 1 flint_and_steel.
 */
await skills.log(bot, "Starting to build a Nether Portal...");
let botPos = bot.entity.position;
let startX = Math.floor(botPos.x) + 2;
let startY = Math.floor(botPos.y);
let startZ = Math.floor(botPos.z);

// Minimum 10-block portal frame
let obsidianLocations = [
    [0, -1, 0], [1, -1, 0], // bottom
    [-1, 0, 0], [2, 0, 0],  // sides
    [-1, 1, 0], [2, 1, 0],
    [-1, 2, 0], [2, 2, 0],
    [0, 3, 0], [1, 3, 0]    // top
];

for (let loc of obsidianLocations) {
    let ptX = startX + loc[0];
    let ptY = startY + loc[1];
    let ptZ = startZ + loc[2];

    // Check if the block is already solid (we might not need to place here)
    let blockAt = bot.blockAt(new Vec3(ptX, ptY, ptZ));
    if (blockAt && blockAt.name !== 'obsidian') {
        let success = await skills.placeBlock(bot, 'obsidian', ptX, ptY, ptZ);
        if (!success) {
            await skills.log(bot, `Failed to place obsidian at ${ptX}, ${ptY}, ${ptZ}`);
            return false; // Yield failure so the task manager knows it didn't complete
        }
    }
}

await skills.log(bot, "Obsidian frame complete, igniting...");
let igniteSuccess = await skills.placeBlock(bot, 'flint_and_steel', startX, startY, startZ);

if (igniteSuccess) {
    await skills.log(bot, "Successfully built and ignited the nether portal! Walk into it to travel to the Nether.");
    return true;
} else {
    await skills.log(bot, "Failed to ignite the portal.");
    return false;
}
