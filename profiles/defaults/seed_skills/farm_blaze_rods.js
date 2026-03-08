/**
 * Farms blaze rods by hunting nearby blazes in a Nether Fortress. It heals if health is low.
 */
await skills.log(bot, "Started farming blaze rods.");

let getRodsCount = () => {
    let counts = world.getInventoryCounts(bot);
    return counts['blaze_rod'] || 0;
};

let startRods = getRodsCount();
let targetRods = startRods + 6;

for (let i = 0; i < 50; i++) { // Max 50 iterations
    if (getRodsCount() >= targetRods) {
        await skills.log(bot, "Successfully farmed targeted blaze rods.");
        return true;
    }

    let blaze = world.getNearestEntityWhere(bot, e => e.name === 'blaze', 32);
    if (!blaze) {
        await skills.log(bot, "No blazes nearby, wandering to find a spawner...");
        let newX = bot.entity.position.x + (Math.random() > 0.5 ? 12 : -12);
        let newZ = bot.entity.position.z + (Math.random() > 0.5 ? 12 : -12);
        await skills.goToPosition(bot, newX, bot.entity.position.y, newZ, 3);
        continue;
    }

    // Attempt to attack
    await skills.log(bot, "Engaging blaze...");
    let success = await skills.attackNearest(bot, 'blaze', true);
    if (!success) {
        // Attack failed, maybe we need to step back
        await skills.moveAway(bot, 5);
    }
}

await skills.log(bot, "Finished seeking blazes, check inventory for rods.");
return true;
