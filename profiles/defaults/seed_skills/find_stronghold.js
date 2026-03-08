/**
 * Follows an Ender Eye to locate the Stronghold. Keep using it as you travel.
 */
await skills.log(bot, "Finding stronghold with eye of ender...");

let hasEye = await skills.equip(bot, 'ender_eye');
if (!hasEye) {
    await skills.log(bot, "I don't have any eye of ender equipped!");
    return false;
}

await bot.look(bot.entity.yaw, 0.5); // Look slightly up
bot.activateItem();
await new Promise(r => setTimeout(r, 1000));

let eyeEntity = world.getNearestEntityWhere(bot, e => e.name === 'eye_of_ender', 32);
if (eyeEntity) {
    let travelX = eyeEntity.position.x;
    let travelZ = eyeEntity.position.z;
    await skills.log(bot, `Eye went towards ${travelX}, ${travelZ}. Formatting route...`);

    // Extrapolate direction
    let dirX = travelX - bot.entity.position.x;
    let dirZ = travelZ - bot.entity.position.z;
    let length = Math.sqrt(dirX * dirX + dirZ * dirZ);
    dirX = (dirX / length) * 60; // Travel 60 blocks in that direction
    dirZ = (dirZ / length) * 60;

    await skills.goToPosition(bot, bot.entity.position.x + dirX, bot.entity.position.y, bot.entity.position.z + dirZ, 3);
    await skills.log(bot, "Traveled towards the eye. Throw another one to verify direction.");
    return true;
} else {
    await skills.log(bot, "Couldn't track the eye. Maybe be in overworld or throw it higher.");
    return false;
}
