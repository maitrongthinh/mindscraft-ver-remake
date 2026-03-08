import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import path from 'path';

export class MemoryBank {
	constructor() {
		this.memory = {};
		this._spatialMemoryDir = null;
		this._spatialMemoryFp = null;
	}

	// === Existing API (unchanged) ===

	rememberPlace(name, x, y, z) {
		this.memory[name] = [x, y, z];
	}

	recallPlace(name) {
		return this.memory[name];
	}

	getJson() {
		return this.memory;
	}

	loadJson(json) {
		this.memory = json;
	}

	getKeys() {
		return Object.keys(this.memory).join(', ');
	}

	// === Spatial Memory: Persist ===

	/**
	 * Initialize spatial memory file path for a given bot name.
	 * Must be called once after bot name is known.
	 * @param {string} botName
	 */
	initSpatialMemory(botName) {
		if (!botName) return;
		this._spatialMemoryDir = `./bots/${botName}`;
		this._spatialMemoryFp = `./bots/${botName}/spatial_memory.json`;
		mkdirSync(this._spatialMemoryDir, { recursive: true });
	}

	/**
	 * Save spatial memory (block positions) to disk.
	 */
	saveSpatialMemory() {
		if (!this._spatialMemoryFp) return;
		try {
			const spatialData = {};
			for (const [key, value] of Object.entries(this.memory)) {
				// Only save block entries (those with _x_y_z pattern or coordinate arrays)
				if (Array.isArray(value) && value.length === 3) {
					spatialData[key] = value;
				}
			}
			writeFileSync(this._spatialMemoryFp, JSON.stringify(spatialData, null, 2), 'utf8');
		} catch (err) {
			console.error('Failed to save spatial memory:', err.message);
		}
	}

	/**
	 * Load spatial memory from disk. Merges with existing in-memory data.
	 */
	loadSpatialMemory() {
		if (!this._spatialMemoryFp || !existsSync(this._spatialMemoryFp)) return;
		try {
			const data = JSON.parse(readFileSync(this._spatialMemoryFp, 'utf8'));
			if (data && typeof data === 'object') {
				for (const [key, value] of Object.entries(data)) {
					if (Array.isArray(value) && value.length === 3) {
						this.memory[key] = value;
					}
				}
				console.log(`Loaded ${Object.keys(data).length} spatial memory entries.`);
			}
		} catch (err) {
			console.error('Failed to load spatial memory:', err.message);
		}
	}

	// === Spatial Memory: Block Tracking ===

	/**
	 * Remember a block at a specific position.
	/**
	 * @param {string} blockName - e.g. 'diamond_ore'
	 * @param {number} x
	 * @param {number} y
	 * @param {number} z
	 * @param {string} dimension - e.g. 'minecraft:overworld'
	 */
	rememberBlock(blockName, x, y, z, dimension = 'minecraft:overworld') {
		const rx = Math.floor(x);
		const ry = Math.floor(y);
		const rz = Math.floor(z);
		const key = `${dimension}:${blockName}_${rx}_${ry}_${rz}`;
		this.memory[key] = [rx, ry, rz];
	}

	/**
	 * Forget all block entries at a specific position.
	 * Called when a block is broken/changed to air.
	 * @param {number} x
	 * @param {number} y
	 * @param {number} z
	 * @param {string} dimension
	 */
	forgetBlock(x, y, z, dimension = 'minecraft:overworld') {
		const rx = Math.floor(x);
		const ry = Math.floor(y);
		const rz = Math.floor(z);
		const suffix = `_${rx}_${ry}_${rz}`;
		const keysToDelete = [];
		for (const key of Object.keys(this.memory)) {
			const isMatch = key.startsWith(`${dimension}:`) || (!key.includes(':') && dimension === 'minecraft:overworld');
			if (isMatch && key.endsWith(suffix)) {
				keysToDelete.push(key);
			}
		}
		for (const key of keysToDelete) {
			delete this.memory[key];
		}
		// Removed immediate save to disk. Relying on auto-save loop in agent.js to prevent stuttering.
	}

	/**
	 * Enforce a hard limit on the spatial memory size to prevent memory leaks on disk and in RAM.
	 * Culls the lowest-value blocks (or just the oldest/random if values aren't strictly ordered) when limit is exceeded.
	 */
	enforceLimits(limit = 5000) {
		let keys = Object.keys(this.memory);
		if (keys.length <= limit) return;

		// Bảng xếp hạng các block "Không Được Phép Quên"
		const HIGH_PRIORITY_BLOCKS = [
			'bed', 'chest', 'furnace', 'crafting_table', 'spawner', 'door',
			'blast_furnace', 'smoker', 'barrel', 'shulker_box'
		];

		// Đánh giá trọng số ưu tiên: 1 = Rác (bị xóa trước), 2 = Bình thường, 3 = Cực kỳ quan trọng (nhà)
		const getPriority = (key) => {
			for (const hpBlock of HIGH_PRIORITY_BLOCKS) {
				if (key.includes(hpBlock)) return 3;
			}
			if (key.includes('ore') || key.includes('diamond') || key.includes('gold') || key.includes('iron')) return 2;
			return 1;
		};

		// Sắp xếp keys: Ưu tiên thấp lên đầu (để bị cắt trước)
		keys.sort((a, b) => getPriority(a) - getPriority(b));

		// Drop the keys that exceed the limit, starting from the lowest priority
		const keysToDrop = keys.slice(0, keys.length - limit);
		let droppedCount = 0;
		for (const key of keysToDrop) {
			// Cơ chế bảo vệ cú chót cho priority 3 (Nếu lỡ memory đầy toàn đồ quan trọng thì ko xoá)
			if (getPriority(key) === 3) continue;
			delete this.memory[key];
			droppedCount++;
		}
		if (droppedCount > 0) {
			console.log(`[SpatialMemory] Memory limit reached. Culled ${droppedCount} low-priority block entries.`);
		}
	}

	// === Spatial Memory: Query (Chunk-optimized) ===

	/**
	 * Get chunk key for a position (16x16 grid).
	 * @param {number} x
	 * @param {number} z
	 * @returns {string}
	 */
	_chunkKey(x, z) {
		return `${Math.floor(x) >> 4}_${Math.floor(z) >> 4}`;
	}

	/**
	 * Find the nearest remembered block matching a keyword.
	 * Uses chunk-based partitioning: only scans the 3x3 chunk grid around the bot first.
	 * Falls back to full scan if no matches found in nearby chunks.
	 * @param {string} keyword - e.g. 'diamond', 'chest'
	 * @param {{ x: number, y: number, z: number }} botPosition - bot's current position
	 * @param {string} dimension - bot's current dimension
	 * @returns {string} Human-readable result string, or 'not found' message
	 */
	findNearest(keyword, botPosition, dimension = 'minecraft:overworld') {
		if (!keyword || !botPosition) {
			return 'Invalid query: missing keyword or bot position.';
		}
		const lowerKeyword = keyword.toLowerCase();

		// Build set of 3x3 neighbor chunk keys around bot
		const botChunkX = Math.floor(botPosition.x) >> 4;
		const botChunkZ = Math.floor(botPosition.z) >> 4;
		const nearbyChunks = new Set();
		for (let dx = -1; dx <= 1; dx++) {
			for (let dz = -1; dz <= 1; dz++) {
				nearbyChunks.add(`${botChunkX + dx}_${botChunkZ + dz}`);
			}
		}

		// First pass: only scan entries in nearby chunks and matching dimension
		let matches = this._searchMemory(lowerKeyword, botPosition, (key, coords) => {
			const isDimMatch = key.startsWith(`${dimension}:`) || (!key.includes(':') && dimension === 'minecraft:overworld');
			return isDimMatch && nearbyChunks.has(this._chunkKey(coords[0], coords[2]));
		});

		// Fallback: if nothing found nearby, do full scan matching dimension
		if (matches.length === 0) {
			matches = this._searchMemory(lowerKeyword, botPosition, (key, coords) => {
				return key.startsWith(`${dimension}:`) || (!key.includes(':') && dimension === 'minecraft:overworld');
			});
		}

		if (matches.length === 0) {
			return `No remembered locations matching "${keyword}" in ${dimension}.`;
		}

		matches.sort((a, b) => a.dist - b.dist);
		const nearest = matches[0];
		const blockName = nearest.key.replace(/_-?\d+_-?\d+_-?\d+$/, '');
		return `Nearest ${blockName}: x=${nearest.coords[0]}, y=${nearest.coords[1]}, z=${nearest.coords[2]} (${nearest.dist.toFixed(1)} blocks away). ${matches.length} total matches remembered.`;
	}

	/**
	 * Internal search helper. Scans memory entries matching keyword, optionally filtered.
	 * @param {string} lowerKeyword
	 * @param {{ x: number, y: number, z: number }} botPosition
	 * @param {Function|null} filterFn - optional filter(key, coords) => boolean
	 * @returns {Array<{key: string, coords: number[], dist: number}>}
	 */
	_searchMemory(lowerKeyword, botPosition, filterFn) {
		const matches = [];
		for (const [key, coords] of Object.entries(this.memory)) {
			if (!Array.isArray(coords) || coords.length !== 3) continue;
			if (!key.toLowerCase().includes(lowerKeyword)) continue;
			if (filterFn && !filterFn(key, coords)) continue;

			const dx = coords[0] - botPosition.x;
			const dy = coords[1] - botPosition.y;
			const dz = coords[2] - botPosition.z;
			const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
			matches.push({ key, coords, dist });
		}
		return matches;
	}

	/**
	 * Verify a remembered block still exists at its position using bot.blockAt().
	 * If the block is now air, remove it from memory. Call this when bot is close to target.
	 * @param {object} bot - The mineflayer bot instance
	 * @param {string} keyword - Block keyword to verify
	 * @param {{ x: number, y: number, z: number }} botPosition
	 * @param {number} verifyRadius - Only verify blocks within this radius (default 5)
	 * @param {string} dimension - bot's current dimension
	 * @returns {number} Number of stale entries removed
	 */
	verifyAndClean(bot, keyword, botPosition, verifyRadius = 5, dimension = 'minecraft:overworld') {
		if (!bot || !keyword || !botPosition) return 0;
		const lowerKeyword = keyword.toLowerCase();
		let removed = 0;
		const keysToDelete = [];

		for (const [key, coords] of Object.entries(this.memory)) {
			if (!Array.isArray(coords) || coords.length !== 3) continue;
			if (!key.toLowerCase().includes(lowerKeyword)) continue;

			const isDimMatch = key.startsWith(`${dimension}:`) || (!key.includes(':') && dimension === 'minecraft:overworld');
			if (!isDimMatch) continue;

			const dx = coords[0] - botPosition.x;
			const dy = coords[1] - botPosition.y;
			const dz = coords[2] - botPosition.z;
			const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

			if (dist > verifyRadius) continue;

			try {
				const block = bot.blockAt({ x: coords[0], y: coords[1], z: coords[2] });
				if (!block || block.name === 'air' || block.name === 'cave_air' || block.name === 'void_air') {
					keysToDelete.push(key);
				}
			} catch (err) {
				// Silently skip — block might be in unloaded chunk
			}
		}

		for (const key of keysToDelete) {
			delete this.memory[key];
			removed++;
		}

		if (removed > 0) {
			console.log(`[SpatialMemory] Removed ${removed} stale "${keyword}" entries after proximity verification.`);
		}
		return removed;
	}
}