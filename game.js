// Constants
const BASE_ZP_CAP = 20;
const UPDATE_INTERVAL = 1000; // 1 second
const SAVE_INTERVAL = 60000; // 60 seconds
const SAVE_KEY = "zonerunners_save_v3"; // Version bump
const DEFAULT_BARRIER_HEALTH = 1;
const WAVES_PER_LEVEL = 10;
const LEVELS_PER_TILE = 10;
const LEVELS_PER_ZONE = 100;
const BOSS_HEALTH_MULTIPLIER = 50;
const ZONE_BOSS_HEALTH_MULTIPLIER = 250;
const HIDEOUT_BOSS_MULTIPLIER = 1000;

const RUNNER_NAMES = [
    "Bolt", "Scabs", "Hex", "Kronk", "Vile", "Rook", "Fume", "Scar", "Jolt", "Pike",
    "Spanner", "Cram", "Blight", "Wasp", "Vash", "Scamp", "Dreg", "Mute", "Skull", "Tophat",
    "Choke", "Flux", "Zero", "Nail", "Creep", "Vantage", "Shard", "Grime", "Cloud", "Tusk",
    "Rattle", "Tank", "Fangs", "Grave", "Zonos", "Silt", "Bruise", "Void", "Plume", "Crook",
    "Fray", "Brawler", "Scorch", "Mangle", "Ultra", "Stump", "Cinder", "Wretch", "Spooky", "Omen"
];
const NPC_NAME = "Nester's Primo Construction";

// Game Balance Constants
const INITIAL_RUNNER_COUNT = 5;
const RUNNER_STARTING_DPS = 100;
const DPS_GAIN_PER_LEVEL_BASE = 0.5;

const ZP_REWARD_10_LEVELS = 1;
const ZP_REWARD_100_LEVELS = 10;
const ZP_REWARD_MAP_PIECE = 1;
const MAP_COMPLETED_BONUS_DPS = 5;
const ZONE_COMPLETED_BONUS_DPS = 50;

const MAP_PIECE_BASE_CHANCE = 0.01;
const RELIC_FRAGMENT_CHANCE = 0.1;

// Relic Configuration
const RELIC_UPGRADE_BASE_COST = 10;
const RELIC_UPGRADE_COST_PER_TIER = 10;

const STRENGTH_RELIC_BONUS = 0.1;   // DPS Multiplier (additive to base)
const STEAL_RELIC_BONUS = 0.025;    // Chance to double ZP
const SIDEKICK_RELIC_BONUS = 0.025; // Caravan DPS multiplier
const SPEED_RELIC_BONUS = 0.025;    // Solo DPS multiplier (catchup)
const STYLE_RELIC_CAP_BONUS = 4;    // ZP Cap increase
const SUPPLY_RELIC_BONUS = 0.005;   // Support DPS multiplier
const SCAN_RELIC_BONUS = 0.001;     // Map piece chance increase

const RELIC_TYPES = [
    "STRENGTH", "SCOOP", "STEAL", "SIDEKICK",
    "SPEED", "STYLE", "SUPPLY", "SCAN"
];

const RELIC_ABBREVS = {
    "STRENGTH": "STR", "SCOOP": "SCO", "STEAL": "STE", "SIDEKICK": "SDK",
    "SPEED": "SPE", "STYLE": "STY", "SUPPLY": "SUP", "SCAN": "SCA"
};

const STYLE_EMOJIS = {
    0: "🛺", 2: "🚗", 4: "🚕", 6: "🚓", 8: "🚙",
    10: "🚑", 12: "🚐", 14: "🚚", 16: "🚒", 18: "🚌", 20: "🚛"
};

const ENVIRONMENTS = [
    ["🟨","🌵"],
    ["⛰️","🏔","🌋","🗻"],
    ["🌳","🌲","🌱","🌿"],
    ["🏡","🏟","🏢","🏤","🏥","🏦","🏨","🏪","🏫","🏬","🏭","🏗"]
];

function formatLargeNumber(num) {
    if (num < 1000) return Math.floor(num);
    const suffixes = ["", "K", "M", "B", "T"];
    const tier = Math.floor(Math.log10(num) / 3);
    if (tier === 0) return Math.floor(num);
    const suffix = suffixes[tier];
    const scale = Math.pow(10, tier * 3);
    const scaled = num / scale;
    return scaled.toFixed(1) + suffix;
}

function formatRange(numbers) {
    if (numbers.length === 0) return "None";
    numbers.sort((a, b) => a - b);
    let ranges = [];
    let start = numbers[0];
    let prev = numbers[0];

    for (let i = 1; i < numbers.length; i++) {
        if (numbers[i] === prev + 1) {
            prev = numbers[i];
        } else {
            ranges.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
            start = numbers[i];
            prev = numbers[i];
        }
    }
    ranges.push(start === prev ? `${start + 1}` : `${start + 1}-${prev + 1}`);
    return ranges.join(", ");
}

class Runner {
    constructor(id, name, isNPC = false) {
        this.id = id;
        this.name = name;
        this.isNPC = isNPC;

        // Permanent Stats
        this.baseDPS = RUNNER_STARTING_DPS;
        this.relics = {};
        this.fragments = {}; // The "bank" towards next tier
        RELIC_TYPES.forEach(t => {
            this.relics[t] = 0;
            this.fragments[t] = 0;
        });

        // Run State
        this.durability = 0;
        this.zpCollected = 0; // Accumulated on current run
        this.fragmentsCollected = {}; // Accumulated on current run
        RELIC_TYPES.forEach(t => this.fragmentsCollected[t] = 0);

        this.zone = 0;
        this.levelInZone = 1;
        this.globalLevel = 1;
        this.wave = 1;
        this.barrierHealth = DEFAULT_BARRIER_HEALTH;
        this.currentSegmentIndex = 0;
        this.stepInSegment = 0;
        this.targetZone = -1;
        this.dps = RUNNER_STARTING_DPS; // Snapshot for run
        this.relicsSnapshot = {};
        this.mapBonusesApplied = new Set();
        this.zoneBonusesApplied = new Set();

        // Lifecycle State
        this.state = "READY"; // READY, RUNNING, UPGRADING
        this.upgradeQueue = [];
        this.currentUpgrade = null;
        this.warpTimestamp = 0;
    }

    startRun() {
        this.state = "RUNNING";
        this.zone = 0;
        this.levelInZone = 1;
        this.globalLevel = 1;
        this.wave = 1;
        this.barrierHealth = DEFAULT_BARRIER_HEALTH;
        this.currentSegmentIndex = 0;
        this.stepInSegment = 0;

        this.zpCollected = 0;
        RELIC_TYPES.forEach(t => this.fragmentsCollected[t] = 0);

        // Snapshot stats
        this.dps = this.baseDPS;
        this.relicsSnapshot = { ...this.relics };
        this.mapBonusesApplied = new Set();
        this.zoneBonusesApplied = new Set();

        // Apply Bonuses for Constructed Roads
        // Assuming game.conqueredZones contains Zone indices (0-based) where roads are built
        // We need to access the game instance to check conqueredZones/mapPieces.
        // Since `game` is global or passed, we access global `game`.
        if (typeof game !== 'undefined') {
            // Apply bonuses for constructed roads
            game.conqueredZones.forEach(z => {
                // Zone Bonus
                if (!this.zoneBonusesApplied.has(z)) {
                    this.dps += ZONE_COMPLETED_BONUS_DPS;
                    this.zoneBonusesApplied.add(z);
                }
                // Map Bonuses (10 sets per zone)
                for (let i = 0; i < 10; i++) {
                     let mapKey = `${z}_${i}`; // Using internal key format logic
                     // If road is built, all maps in that zone are effectively considered "bonus active"
                     // or should we check if they are actually completed?
                     // Original logic: "With Road: ... ALL map set bonuses ... applied immediately"
                     // So we apply them all for that zone.
                     if (!this.mapBonusesApplied.has(mapKey)) {
                         // Check if map is actually completed?
                         // Python: "for absolute_set_key in game_state.completed_maps..."
                         // JS: Let's assume if road is built, we get the bonuses regardless or only if completed?
                         // "Completed Maps ... bonuses ... applied properly".
                         // Python `start_player_run`:
                         // `for road_zone_num in game_state.constructed_roads: ... for set_in_zone_offset in range(SETS_PER_ZONE): ... if str(abs_set_for_road) in completed_maps ...`
                         // So we MUST check if the map is completed even if road exists.

                         // In JS, map completion is per zone array `this.mapPieces[z]`.
                         let pieces = game.mapPieces[z] || [];
                         let start = i * 10;
                         let end = start + 10;
                         let p = pieces.slice(start, end).filter(Boolean).length;
                         if (p === 10) {
                              this.dps += MAP_COMPLETED_BONUS_DPS;
                              this.mapBonusesApplied.add(mapKey);
                         }
                    }
                }
            });

            // Apply bonuses for current location (Zone 0 usually) if not covered by road
            let startZone = 0; // Always starts at 0
            if (!this.zoneBonusesApplied.has(startZone)) {
                // Check if Zone 0 is completed
                let pieces = game.mapPieces[startZone] || [];
                if (pieces.filter(Boolean).length === 100) {
                     this.dps += ZONE_COMPLETED_BONUS_DPS;
                     this.zoneBonusesApplied.add(startZone);
                }
            }

            // Check Map 0 in Zone 0
            let startMapKey = "0_0";
            if (!this.mapBonusesApplied.has(startMapKey)) {
                 let pieces = game.mapPieces[0] || [];
                 let p = pieces.slice(0, 10).filter(Boolean).length;
                 if (p === 10) {
                     this.dps += MAP_COMPLETED_BONUS_DPS;
                     this.mapBonusesApplied.add(startMapKey);
                 }
            }
        }
    }

    warp() {
        this.state = "QUEUED";
        this.warpTimestamp = Date.now();

        // Durability resets on warp
        this.durability = 0;

        // Queue Upgrades
        this.upgradeQueue = [];

        // 1. DPS Upgrade
        if (this.zpCollected > 0) {
            this.upgradeQueue.push({
                type: 'DPS',
                total: this.zpCollected,
                remaining: this.zpCollected,
                rate: 1 + Math.floor(this.zpCollected * 0.01)
            });
        }

        // 2. Relic Upgrades
        RELIC_TYPES.forEach(type => {
            const amount = this.fragmentsCollected[type];
            if (amount > 0) {
                this.upgradeQueue.push({
                    type: 'RELIC',
                    relicType: type,
                    total: amount,
                    remaining: amount,
                    rate: 1 + Math.floor(amount * 0.01)
                });
            }
        });

        // Clear run collection (moved to queue)
        this.zpCollected = 0;
        RELIC_TYPES.forEach(t => this.fragmentsCollected[t] = 0);

        if (this.upgradeQueue.length === 0) {
            this.state = "READY";
        }
    }

    // For new runners
    initializeWithPhantomZP(targetRelics = {}) {
        this.state = "QUEUED";
        this.warpTimestamp = Date.now();
        this.baseDPS = 0; // Start at 0, build to 100
        this.upgradeQueue = [{
            type: 'DPS',
            total: RUNNER_STARTING_DPS,
            remaining: RUNNER_STARTING_DPS,
            rate: 1 + Math.floor(RUNNER_STARTING_DPS * 0.01) // 2 per sec
        }];

        for (const [type, level] of Object.entries(targetRelics)) {
            let cost = 0;
            for (let l = 0; l < level; l++) {
                cost += RELIC_UPGRADE_BASE_COST + (l * RELIC_UPGRADE_COST_PER_TIER);
            }

            if (cost > 0) {
                this.upgradeQueue.push({
                    type: 'RELIC',
                    relicType: type,
                    total: cost,
                    remaining: cost,
                    rate: 1 + Math.floor(cost * 0.01)
                });
            }
        }
    }

    processUpgrades(dt) { // dt in seconds
        if (this.state !== "UPGRADING") return;

        if (!this.currentUpgrade) {
            if (this.upgradeQueue.length > 0) {
                this.currentUpgrade = this.upgradeQueue.shift();
            } else {
                this.state = "READY";
                return;
            }
        }

        const task = this.currentUpgrade;
        const amount = Math.min(task.remaining, task.rate * dt);

        task.remaining -= amount;

        if (task.type === 'DPS') {
            this.baseDPS += amount;
        } else if (task.type === 'RELIC') {
            // Simulate gathering fragments, then apply
            this.fragments[task.relicType] += amount;
            this.checkRelicLevelUp(task.relicType);
        }

        if (task.remaining <= 0) {
            this.currentUpgrade = null;
        }
    }

    checkRelicLevelUp(type) {
        // Cost: 25 + (Tier * 25)
        while (true) {
            const tier = this.relics[type];
            const cost = RELIC_UPGRADE_BASE_COST + (tier * RELIC_UPGRADE_COST_PER_TIER);
            if (this.fragments[type] >= cost) {
                this.fragments[type] -= cost;
                this.relics[type]++;
                game.log(`${this.name} upgraded ${type} to Tier ${this.relics[type]}!`);
            } else {
                break;
            }
        }
    }

    getEffectiveDPS(caravanSize, supplyBonusMultiplier, highestReachedZone, mapCompleted) {
        if (this.isNPC) return 999999999;

        let eff = this.dps; // Uses snapshot DPS
        const relics = this.relicsSnapshot;

        if (caravanSize > 1) {
            const sidekick = relics["SIDEKICK"] || 0;
            eff *= (1 + (sidekick * SIDEKICK_RELIC_BONUS));
        }

        if (supplyBonusMultiplier > 0) {
            eff *= (1 + supplyBonusMultiplier);
        }

        if (this.zone < highestReachedZone) {
            const speed = relics["SPEED"] || 0;
            eff *= (1 + (speed * SPEED_RELIC_BONUS));
        }

        return eff;
    }

    getDPSGain() {
        if (this.isNPC) return 0;
        let base = DPS_GAIN_PER_LEVEL_BASE;
        const str = this.relicsSnapshot["STRENGTH"] || 0;
        return base + (str * STRENGTH_RELIC_BONUS);
    }

    getCap() {
        if (this.isNPC) return Infinity;
        // Use SNAPSHOT relics for cap during run? Yes.
        const style = this.relicsSnapshot["STYLE"] || 0;
        return BASE_ZP_CAP + (style * STYLE_RELIC_CAP_BONUS);
    }

    getEmoji() {
        if (this.isNPC) return "🚧";
        // Use current relics for display in list, snapshot for map?
        // Usually snapshot if running, current if not.
        // But getEmoji is used in map rendering (Running).
        // Let's use relicsSnapshot if available (running), else relics.

        let tier = 0;
        if (this.state === "RUNNING") {
             tier = this.relicsSnapshot["STYLE"] || 0;
        } else {
             tier = this.relics["STYLE"] || 0;
        }

        let t = Math.floor(tier / 2) * 2;
        if (t > 20) t = 20;
        return STYLE_EMOJIS[t] || "🛺";
    }
}

class MapSegment {
    constructor(index, patternString, previousEnvironment) {
        this.index = index;
        this.patternString = patternString;
        this.grid = [];
        this.pathCoordinates = [];

        let availableEnvs = ENVIRONMENTS.filter(e => e !== previousEnvironment);
        if (index === 0) {
            this.environment = ENVIRONMENTS[0];
        } else {
            this.environment = availableEnvs[Math.floor(Math.random() * availableEnvs.length)];
        }

        this.generateGrid();
        this.tracePath();
    }

    generateGrid() {
        const rows = this.patternString.trim().split('\n');
        this.grid = rows.map((row, y) => {
            return [...row.trim()].map((char, x) => {
                if (char === '⬜') {
                    return this.environment[Math.floor(Math.random() * this.environment.length)];
                } else if (char === '⬛') {
                    return '⬛';
                }
                return char;
            });
        });

        if (this.index === 0) {
            if (this.grid[1] && this.grid[1][7]) this.grid[1][7] = "🏝️";
        }
    }

    tracePath() {
        let nodes = [];
        for (let y = 0; y < this.grid.length; y++) {
            for (let x = 0; x < this.grid[y].length; x++) {
                if (this.grid[y][x] === '⬛') {
                    nodes.push({x, y});
                }
            }
        }

        if (nodes.length === 0) return;
        nodes.sort((a, b) => a.y - b.y || a.x - b.x);

        let visited = new Set();
        let current = nodes[0];

        if (this.index === 0) {
            let startNode = nodes.find(n => n.x === 7 && n.y === 2);
            if (startNode) current = startNode;
        }

        while (current) {
            this.pathCoordinates.push(current);
            visited.add(`${current.x},${current.y}`);
            let neighbors = [
                {x: current.x, y: current.y - 1},
                {x: current.x, y: current.y + 1},
                {x: current.x - 1, y: current.y},
                {x: current.x + 1, y: current.y}
            ];
            let next = neighbors.find(n =>
                nodes.some(node => node.x === n.x && node.y === n.y) &&
                !visited.has(`${n.x},${n.y}`)
            );
            current = next;
        }
    }

    render(runnersOnThisSegment = [], conqueredZones = [], maxStepExplored = -1, globalTileOffset = 0, mapPieces = {}, activeHideouts = new Set(), npcs = []) {
        let html = '';

        runnersOnThisSegment.sort((a, b) => {
            if (a.isNPC && !b.isNPC) return -1;
            if (!a.isNPC && b.isNPC) return 1;
            let sA = a.relicsSnapshot["STYLE"] || 0;
            let sB = b.relicsSnapshot["STYLE"] || 0;
            return sB - sA;
        });

        let mapPosCounts = {};
        runnersOnThisSegment.forEach(runner => {
            if (runner.stepInSegment < this.pathCoordinates.length) {
                let pos = this.pathCoordinates[runner.stepInSegment];
                let key = `${pos.x},${pos.y}`;
                if(!mapPosCounts[key]) mapPosCounts[key] = [];
                mapPosCounts[key].push(runner);
            }
        });

        let visibleSet = new Set();
        if (this.index === 0) {
            for (let ox = 6; ox <= 8; ox++) {
                for (let oy = 0; oy <= 2; oy++) {
                    visibleSet.add(`${ox},${oy}`);
                }
            }
        }

        if (maxStepExplored >= 0) {
            for (let i = 0; i <= maxStepExplored && i < this.pathCoordinates.length; i++) {
                let p = this.pathCoordinates[i];
                for(let dy=-1; dy<=1; dy++){
                    for(let dx=-1; dx<=1; dx++){
                        visibleSet.add(`${p.x + dx},${p.y + dy}`);
                    }
                }
            }
        }

        for (let y = 0; y < this.grid.length; y++) {
            html += '<div class="map-row">';
            for (let x = 0; x < this.grid[y].length; x++) {
                let char = this.grid[y][x];
                let key = `${x},${y}`;

                let pathIdx = this.pathCoordinates.findIndex(p => p.x === x && p.y === y);
                let isPath = pathIdx !== -1;

                let displayChar = "☁️";
                let styleClass = "map-cell";
                let isVisible = visibleSet.has(key);

                if (isVisible) {
                    if (isPath) {
                        let globalTileIndex = globalTileOffset + pathIdx;
                        let zoneIndex = Math.floor(globalTileIndex / 10);
                        let tileInZone = globalTileIndex % 10;

                        let zonePieces = mapPieces[zoneIndex] || [];
                        let startIdx = tileInZone * 10;
                        let endIdx = startIdx + 10;
                        let piecesForThisTile = zonePieces.slice(startIdx, endIdx).filter(Boolean).length;

                        let isConstructed = false;
                        let npc = npcs.find(r => r.targetZone === zoneIndex);
                        if (npc) {
                             if (npc.currentSegmentIndex > this.index) isConstructed = true;
                             else if (npc.currentSegmentIndex === this.index && npc.stepInSegment > pathIdx) isConstructed = true;
                        }

                        if (mapPosCounts[key]) {
                            displayChar = mapPosCounts[key][0].getEmoji();
                        } else if (conqueredZones.includes(zoneIndex) || isConstructed) {
                            displayChar = "⬛";
                        } else {
                             if (piecesForThisTile >= 10) {
                                 displayChar = "🟫";
                             } else if (piecesForThisTile > 0) {
                                 displayChar = "🟧";
                             } else {
                                 displayChar = this.environment[0];
                             }
                        }

                        if (activeHideouts.has(zoneIndex) && tileInZone === 9 && piecesForThisTile >= 10) {
                            if (!mapPosCounts[key]) displayChar = "⛺";
                        }

                    } else {
                        displayChar = char;
                        if (char === '⬛') displayChar = "☁️";
                    }
                }

                html += `<div class="${styleClass}">${displayChar}</div>`;
            }
            html += '</div>';
        }
        return html;
    }
}

class GameState {
    constructor() {
        this.runners = [];
        this.squadLevel = 0;
        this.totalWarps = 0;
        this.visibleRunnersCount = 1;

        this.mapSegments = [];
        this.activePatternIndex = -1;

        this.highestReachedZone = 0;
        this.mapPieces = {};
        this.mapPieceBoosts = {};
        this.completedMaps = {};

        this.zonesReadyForHideout = new Set();
        this.activeHideouts = new Set();
        this.conqueredZones = [];
        this.pendingRoads = new Set();
        this.npcCooldownTimestamp = 0;

        this.maxStepPerSegment = {};

        this.loopId = null;
        this.saveLoopId = null;

        // Mobile Tabs State
        this.currentMobileTab = 1; // Default to Tracker (index 1)
        this.touchStartX = 0;
        this.touchEndX = 0;
    }

    getUniqueRunnerName() {
        const usedNames = new Set(this.runners.filter(r => !r.isNPC).map(r => r.name));
        const available = RUNNER_NAMES.filter(n => !usedNames.has(n));
        if (available.length === 0) return `Runner ${this.runners.length + 1}`;
        return available[Math.floor(Math.random() * available.length)];
    }

    selectStartingRelics() {
        let t2Used = new Set();
        let t1Used = new Set();

        this.runners.filter(r => !r.isNPC).forEach(r => {
            // Check active relics
            for (const [type, lvl] of Object.entries(r.relics)) {
                if (lvl >= 2) t2Used.add(type);
                if (lvl >= 1) t1Used.add(type);
            }
            // Also check planned relics if upgrading
            if (r.state === "UPGRADING" && r.upgradeQueue) {
                // If they are upgrading a relic, it might not be in r.relics yet?
                // Actually fragments are queued, so we can't easily know the target level without parsing the queue costs
                // or just relying on random chance. Given the rarity of collision, checking active relics is decent.
                // But better to be safe? The queue has 'type' and 'relicType'.
                // If there's a relic upgrade queued, we can assume it might reach T1 or T2.
                // Let's stick to checking `r.relics`.
            }
        });

        // 1. Pick one T2 Relic
        let availableForT2 = RELIC_TYPES.filter(t => !t2Used.has(t));
        if (availableForT2.length === 0) availableForT2 = [...RELIC_TYPES];
        const t2Choice = availableForT2[Math.floor(Math.random() * availableForT2.length)];

        // 2. Pick two T1 Relics
        // "Same for both T1 relics" - ensure they are unique if possible
        let availableForT1 = RELIC_TYPES.filter(t => !t1Used.has(t) && t !== t2Choice);
        let t1Choices = [];

        if (availableForT1.length >= 2) {
            // Pick 2 random unique
            availableForT1.sort(() => Math.random() - 0.5);
            t1Choices.push(availableForT1[0]);
            t1Choices.push(availableForT1[1]);
        } else {
            // Take what is available
            t1Choices.push(...availableForT1);
            // Fill rest
            let pool = RELIC_TYPES.filter(t => t !== t2Choice && !t1Choices.includes(t));
            pool.sort(() => Math.random() - 0.5);
            while (t1Choices.length < 2 && pool.length > 0) {
                t1Choices.push(pool.pop());
            }
        }

        let chosen = { [t2Choice]: 2 };
        t1Choices.forEach(t => chosen[t] = 1);
        return chosen;
    }

    start() {
        this.load();

        // Init Mobile UI
        this.initMobileUI();

        if (this.runners.length === 0) {
            // First time setup - Create ONLY the first runner
            let name = this.getUniqueRunnerName();
            let r = new Runner(0, name);
            r.state = "READY";
            r.baseDPS = RUNNER_STARTING_DPS;

            // Apply Starting Relics immediately for Runner 1
            // 1x T2, 2x T1 (Randomly chosen, though no other runners exist to conflict with)
            // Just pick random ones
            let types = [...RELIC_TYPES].sort(() => Math.random() - 0.5);
            let t2 = types[0];
            let t1a = types[1];
            let t1b = types[2];
            r.relics[t2] = 2;
            r.relics[t1a] = 1;
            r.relics[t1b] = 1;
            r.relicsSnapshot = { ...r.relics }; // Sync snapshot

            this.runners.push(r);
        }

        while (this.mapSegments.length < 2) {
            this.generateNextMapSegment();
        }
        this.renderMap();
        this.updateMapProgressDisplay();
        this.updateRunnerList();

        this.loopId = setInterval(() => this.update(), UPDATE_INTERVAL);
        this.saveLoopId = setInterval(() => this.save(), SAVE_INTERVAL);
    }

    initMobileUI() {
        // Event Listeners for Tab Buttons
        const buttons = document.querySelectorAll('.tab-btn');
        buttons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabIndex = parseInt(e.target.getAttribute('data-tab'));
                this.switchMobileTab(tabIndex);
            });
        });

        // Swipe Gestures
        const layout = document.getElementById('game-layout');

        layout.addEventListener('touchstart', (e) => {
            this.touchStartX = e.changedTouches[0].screenX;
        }, {passive: true});

        layout.addEventListener('touchend', (e) => {
            this.touchEndX = e.changedTouches[0].screenX;
            this.handleGesture();
        }, {passive: true});

        // Set initial state
        this.switchMobileTab(this.currentMobileTab);
    }

    handleGesture() {
        if (this.touchEndX < this.touchStartX - 50) {
            // Swipe Left (Go to next tab)
            if (this.currentMobileTab < 2) {
                this.switchMobileTab(this.currentMobileTab + 1);
            }
        }
        if (this.touchEndX > this.touchStartX + 50) {
            // Swipe Right (Go to prev tab)
            if (this.currentMobileTab > 0) {
                this.switchMobileTab(this.currentMobileTab - 1);
            }
        }
    }

    switchMobileTab(index) {
        this.currentMobileTab = index;
        const layout = document.getElementById('game-layout');

        // Remove all tab classes
        layout.classList.remove('mobile-tab-0', 'mobile-tab-1', 'mobile-tab-2');

        // Add active tab class
        layout.classList.add(`mobile-tab-${index}`);

        // Update button states
        const buttons = document.querySelectorAll('.tab-btn');
        buttons.forEach(btn => {
            if (parseInt(btn.getAttribute('data-tab')) === index) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    log(msg) {
        const logContainer = document.getElementById('game-log-content');
        if (!logContainer) return;
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.textContent = `> ${msg}`;
        logContainer.prepend(entry);
        if (logContainer.children.length > 50) logContainer.lastChild.remove();
    }

    awardZP(runner, amount, isSteal = false) {
        runner.zpCollected += amount;
        let onRoad = this.conqueredZones.includes(runner.zone);
        if (!onRoad && !isSteal) {
            runner.durability += amount;
        }
    }

    getMaxRunners() {
        return INITIAL_RUNNER_COUNT + this.squadLevel;
    }

    getNextLevelThreshold() {
        if (this.squadLevel >= 20) return Infinity;
        return (this.squadLevel + 1) * 10;
    }

    update() {
        // 1. Process NPC Spawning
        this.processNPCSpawning();

        // 2. Manage Runner Unlocks
        const max = this.getMaxRunners();
        // Ensure we have 'max' runners instantiated or appearing
        if (this.runners.length < max) {
            // Check if last runner is ready/running
            const last = this.runners[this.runners.length - 1];
            if (last && (last.state === "READY" || last.state === "RUNNING")) {
                // Spawn next
                let id = this.runners.length;
                let name = this.getUniqueRunnerName();
                let newRunner = new Runner(id, name);

                let startingRelics = this.selectStartingRelics();
                newRunner.initializeWithPhantomZP(startingRelics);

                this.runners.push(newRunner);
            }
        }

        // 3. Manage Upgrade Queue
        this.manageUpgradeQueue();

        // 4. Process Upgrades for Local Runners
        this.runners.forEach(r => {
            if (r.state === "UPGRADING") {
                r.processUpgrades(UPDATE_INTERVAL / 1000);
            }
        });

        // 5. Run Logic (Movement, Fighting)
        let activeRunners = this.runners.filter(r => r.state === "RUNNING" || r.isNPC);

        if (activeRunners.length > 0) {
            let sortedRunners = [...activeRunners].sort((a, b) => {
                if (a.zone !== b.zone) return b.zone - a.zone;
                return b.levelInZone - a.levelInZone;
            });

            let caravans = {};
            sortedRunners.forEach(r => {
                let key = `${r.globalLevel}`;
                if (!caravans[key]) caravans[key] = [];
                caravans[key].push(r);

                if (this.maxStepPerSegment[r.currentSegmentIndex] === undefined || r.stepInSegment > this.maxStepPerSegment[r.currentSegmentIndex]) {
                    this.maxStepPerSegment[r.currentSegmentIndex] = r.stepInSegment;
                }
            });

            for (let key in caravans) {
                let group = caravans[key];

                group.sort((a, b) => {
                    if (a.isNPC && !b.isNPC) return -1;
                    if (!a.isNPC && b.isNPC) return 1;
                    let sA = a.relicsSnapshot["STYLE"] || 0;
                    let sB = b.relicsSnapshot["STYLE"] || 0;
                    return sB - sA;
                });

                let leader = group[0];
                let currentZone = Math.floor(leader.globalLevel / LEVELS_PER_ZONE);

                let isConquered = this.conqueredZones.includes(currentZone);
                let zonePieces = this.mapPieces[currentZone] || [];
                let isMapped = zonePieces.length === 100 && zonePieces.every(Boolean);

                // Calculate accumulated supply bonus from runners strictly ahead
                let supplyBonusFromAhead = 0;
                activeRunners.forEach(other => {
                    // Bonus comes from runners strictly ahead and not NPCs
                    if (other.globalLevel > leader.globalLevel && !other.isNPC) {
                        const supplyTier = other.relicsSnapshot["SUPPLY"] || 0;
                        supplyBonusFromAhead += (supplyTier * SUPPLY_RELIC_BONUS);
                    }
                });

                let totalDPS = group.reduce((sum, r) =>
                    sum + r.getEffectiveDPS(
                        group.length,
                        supplyBonusFromAhead,
                        this.highestReachedZone,
                        isMapped
                    ), 0);

                leader.barrierHealth -= totalDPS;

                if (leader.barrierHealth <= 0) {
                    // Wave Complete
                    leader.wave++;

                    let maxWaves = this.getWavesForLevel(leader.globalLevel);

                    if (leader.wave > maxWaves) {
                        // Level Complete
                        this.handleLevelComplete(leader, group);
                    } else {
                        group.forEach(r => r.wave = leader.wave);
                    }

                    let newHP = this.calculateBarrierHealth(leader.globalLevel, leader.wave);
                    group.forEach(r => r.barrierHealth = newHP);
                } else {
                    group.forEach(r => r.barrierHealth = leader.barrierHealth);
                }
            }
        }

        // 6. Check Durability and Warp
        activeRunners.forEach((r, i) => {
            if (!r.isNPC && r.durability >= r.getCap()) {
                this.warpRunner(r);
            }
        });

        // 7. Check Hideouts
        this.checkHideoutSpawns();

        this.ensureMapSegments();
        this.updateTracker(); // Right column (Active Runs)
        this.updateRunnerList(); // Left column (Management)
        this.renderMap();
        this.updateMapProgressDisplay();
    }

    handleLevelComplete(leader, group) {
        // Check Hideout Victory
        let z = Math.floor((leader.globalLevel - 1) / LEVELS_PER_ZONE);
        let levelInZ = ((leader.globalLevel - 1) % LEVELS_PER_ZONE) + 1;
        let hideoutCleared = false;

        if (this.activeHideouts.has(z) && levelInZ === 100) {
            this.activeHideouts.delete(z);
            this.pendingRoads.add(z);
            this.log(`⚔️ Hideout in Zone ${z+1} CLEARED! Road construction pending...`);
            hideoutCleared = true;
        }

        leader.globalLevel++;
        leader.levelInZone = ((leader.globalLevel - 1) % LEVELS_PER_ZONE) + 1;
        leader.wave = 1;

        group.forEach(r => {
            // Map Piece Collection
            if (!r.isNPC) {
                let z = Math.floor((leader.globalLevel - 2) / LEVELS_PER_ZONE);
                let pieceIdx = (leader.globalLevel - 2) % LEVELS_PER_ZONE;

                if (z >= 0 && pieceIdx >= 0) {
                    if (!this.mapPieces[z]) this.mapPieces[z] = Array(100).fill(false);

                    if (!this.mapPieces[z][pieceIdx]) {
                        const scanTier = r.relicsSnapshot["SCAN"] || 0;
                        const baseChance = MAP_PIECE_BASE_CHANCE + (scanTier * SCAN_RELIC_BONUS); // 5% base

                        let boostKey = `${z}_${pieceIdx}`;
                        let currentBoost = this.mapPieceBoosts[boostKey] || 0;
                        let totalChance = baseChance + (currentBoost / 100.0);

                        if (Math.random() < totalChance) {
                             this.mapPieces[z][pieceIdx] = true;
                             if (!r.isNPC) this.awardZP(r, ZP_REWARD_MAP_PIECE);
                             delete this.mapPieceBoosts[boostKey];

                             // Check Full
                             if (this.mapPieces[z].every(Boolean)) {
                                 if (!this.conqueredZones.includes(z) && !this.activeHideouts.has(z) && !this.zonesReadyForHideout.has(z) && !this.pendingRoads.has(z)) {
                                     let bossLevel = (z + 1) * LEVELS_PER_ZONE;
                                     let busy = this.runners.some(r => !r.isNPC && r.globalLevel === bossLevel);

                                     if (busy) {
                                         this.zonesReadyForHideout.add(z);
                                         this.log(`🗺️ Zone ${z+1} Fully Mapped! Hideout waiting for area clear...`);
                                     } else {
                                         this.activeHideouts.add(z);
                                         this.log(`🏰 Bandit Hideout Spawned in Zone ${z+1}!`);
                                     }
                                 }
                             }
                        } else {
                            this.mapPieceBoosts[boostKey] = currentBoost + 1;
                        }
                    }
                }
            }

            r.levelInZone = leader.levelInZone;
            r.globalLevel = leader.globalLevel;
            r.wave = 1;

            if (!r.isNPC) {
                let completedLevel = leader.globalLevel - 1;

                // DPS Gain on Run
                r.dps += r.getDPSGain();

                // NEW: Incremental Map/Zone Bonuses
                // Entering new level: leader.globalLevel
                // Determine which Map Set and Zone we are entering.
                // Levels 1-10 = Set 0. Levels 11-20 = Set 1.
                // globalLevel is 1-based.
                let checkLevelIdx = leader.globalLevel - 1; // 0-based index
                let checkZoneIdx = Math.floor(checkLevelIdx / LEVELS_PER_ZONE);
                let checkSetInZone = Math.floor((checkLevelIdx % LEVELS_PER_ZONE) / 10);
                let mapKey = `${checkZoneIdx}_${checkSetInZone}`;

                // Check Map Bonus
                if (!r.mapBonusesApplied.has(mapKey)) {
                     // Check if map is completed
                     let pieces = this.mapPieces[checkZoneIdx] || [];
                     let start = checkSetInZone * 10;
                     let end = start + 10;
                     let p = pieces.slice(start, end).filter(Boolean).length;
                     if (p === 10) {
                         r.dps += MAP_COMPLETED_BONUS_DPS;
                         r.mapBonusesApplied.add(mapKey);
                     }
                }

                // Check Zone Bonus (If we just entered a new zone)
                // Note: This checks every level, but set prevents duplicates.
                if (!r.zoneBonusesApplied.has(checkZoneIdx)) {
                    let pieces = this.mapPieces[checkZoneIdx] || [];
                    if (pieces.filter(Boolean).length === 100) {
                        r.dps += ZONE_COMPLETED_BONUS_DPS;
                        r.zoneBonusesApplied.add(checkZoneIdx);
                    }
                }

                // 1. Zone-based Chance (Every Level)
                // Zone 1 (idx 0) -> 0.1%. Zone 10 (idx 9) -> 1%.
                let currentZoneIdx = Math.floor((completedLevel - 1) / LEVELS_PER_ZONE);
                let zoneChance = Math.min(0.01, (currentZoneIdx + 1) * 0.001);
                if (Math.random() < zoneChance) {
                     this.awardFragment(r, null, true); // true = checkScoop
                }

                // 2. 5th Level Chance (5%)
                if (completedLevel % 10 === 5) {
                    if (Math.random() < 0.05) {
                        this.awardFragment(r, null, true);
                    }
                }

                // 3. 10th Level Chance (10%) & ZP
                if (completedLevel % 10 === 0) {
                    this.awardZP(r, ZP_REWARD_10_LEVELS);

                    const stealTier = r.relicsSnapshot["STEAL"] || 0;
                    if (Math.random() < (stealTier * STEAL_RELIC_BONUS)) {
                         this.awardZP(r, ZP_REWARD_10_LEVELS, true);
                    }

                    if (Math.random() < 0.10) {
                        this.awardFragment(r, null, true);
                    }
                }

                // 4. Zone Completion (Level 100)
                if (completedLevel % 100 === 0) {
                    this.awardZP(r, ZP_REWARD_100_LEVELS);

                    if (hideoutCleared) {
                        // Hideout Bundle: 1 of each, NO SCOOP
                        RELIC_TYPES.forEach(t => this.awardFragment(r, t, false));
                    } else {
                        // Normal Zone Boss: 1 Guaranteed, NO SCOOP
                        this.awardFragment(r, null, false);
                    }
                }
            }

            r.zone = Math.floor((r.globalLevel - 1) / LEVELS_PER_ZONE);
        });

        if (leader.globalLevel % LEVELS_PER_TILE === 1 && leader.globalLevel > 1) {
            this.moveVisualStep(group);
        }

        if (leader.isNPC && (leader.globalLevel - 1) % LEVELS_PER_ZONE === 0) {
            let finishedZone = Math.floor((leader.globalLevel - 2) / LEVELS_PER_ZONE);

            if (finishedZone === leader.targetZone) {
                 if (!this.conqueredZones.includes(finishedZone)) {
                    this.conqueredZones.push(finishedZone);
                    this.log(`🏗️ Road Construction Complete for Zone ${finishedZone+1}!`);
                 }
                 this.runners = this.runners.filter(r => r !== leader);
                 this.npcCooldownTimestamp = Date.now() + 10000;
            }
        }

        let zNew = Math.floor((leader.globalLevel - 1) / LEVELS_PER_ZONE);
        if (zNew > this.highestReachedZone) this.highestReachedZone = zNew;
    }

    checkHideoutSpawns() {
        this.zonesReadyForHideout.forEach(z => {
             let bossLevel = (z + 1) * LEVELS_PER_ZONE;
             let busy = this.runners.some(r => !r.isNPC && r.globalLevel === bossLevel);
             if (!busy) {
                 this.zonesReadyForHideout.delete(z);
                 this.activeHideouts.add(z);
                 this.log(`🏰 Area clear! Bandit Hideout Spawned in Zone ${z+1}!`);
             }
        });
    }

    processNPCSpawning() {
        if (this.runners.some(r => r.isNPC)) return;
        if (Date.now() < this.npcCooldownTimestamp) return;

        let pending = Array.from(this.pendingRoads).sort((a,b)=>a-b);
        if (pending.length === 0) return;

        let target = pending[0];

        if (target === 0 || this.conqueredZones.includes(target - 1)) {
            this.pendingRoads.delete(target);
            this.spawnNPC(target);
        }
    }

    moveVisualStep(group) {
        group.forEach(r => {
            r.stepInSegment++;
            let currentSegment = this.mapSegments[r.currentSegmentIndex];
            if (r.stepInSegment >= currentSegment.pathCoordinates.length) {
                r.currentSegmentIndex++;
                r.stepInSegment = 0;
            }
        });
    }

    ensureMapSegments() {
        let maxSeg = this.runners.reduce((max, r) => Math.max(max, r.currentSegmentIndex), 0);
        if (maxSeg >= this.mapSegments.length - 1) {
            this.generateNextMapSegment();
        }
    }

    awardFragment(runner, type = null, checkScoop = false) {
        if (!type) type = RELIC_TYPES[Math.floor(Math.random() * RELIC_TYPES.length)];
        runner.fragmentsCollected[type]++;
        this.log(`${runner.name} found ${type} fragment`);

        if (checkScoop) {
            const scoopTier = runner.relicsSnapshot["SCOOP"] || 0;
            if (Math.random() < (scoopTier * 0.025)) {
                 let bonusType = RELIC_TYPES[Math.floor(Math.random() * RELIC_TYPES.length)];
                 runner.fragmentsCollected[bonusType]++;
                 this.log(`${runner.name} SCOOPED extra ${bonusType} fragment!`);
            }
        }
    }

    getWavesForLevel(globalLevel) {
        if (globalLevel % 10 === 0) return 1;

        let currentZone = Math.floor((globalLevel - 1) / LEVELS_PER_ZONE);
        let applicableRoads = this.conqueredZones.filter(z => z >= currentZone).length;

        let waves = WAVES_PER_LEVEL - applicableRoads;
        return Math.max(1, waves);
    }

    calculateBarrierHealth(globalLevel, wave) {
        let zone = Math.floor((globalLevel - 1) / LEVELS_PER_ZONE);
        let levelInZone = ((globalLevel - 1) % LEVELS_PER_ZONE) + 1;
        let base = DEFAULT_BARRIER_HEALTH;
        let zoneFactor = Math.pow(Math.max(1, zone + 1), 1.5);
        let levelFactor = Math.pow(Math.max(1, levelInZone), 1.2);
        let health = base * zoneFactor * levelFactor * 1.1;

        let totalWaves = this.getWavesForLevel(globalLevel);
        let roadReduction = 1.0;

        if (wave === totalWaves && (levelInZone % 10 === 0)) {
            let applicableRoads = this.conqueredZones.filter(z => z >= zone).length;
            if (applicableRoads > 0) {
                let reduction = Math.min(applicableRoads * 0.10, 0.90);
                roadReduction = 1.0 - reduction;
            }
        }

        if (levelInZone === LEVELS_PER_ZONE && wave === totalWaves && this.activeHideouts.has(zone)) {
             return Math.floor(health * HIDEOUT_BOSS_MULTIPLIER * roadReduction);
        } else if (levelInZone === LEVELS_PER_ZONE && wave === totalWaves) {
             return Math.floor(health * ZONE_BOSS_HEALTH_MULTIPLIER * roadReduction);
        } else if (levelInZone % 10 === 0 && wave === totalWaves) {
             return Math.floor(health * BOSS_HEALTH_MULTIPLIER * roadReduction);
        }

        return Math.floor(health);
    }

    warpRunner(runner) {
        let totalFragments = Object.values(runner.fragmentsCollected).reduce((a, b) => a + b, 0);
        this.log(`🌀 ${runner.name} warped! Collected +${runner.zpCollected} ZP and +${totalFragments} fragment(s)`);

        // Count for squad level
        this.totalWarps++;

        let requiredForNext = this.getWarpsRequiredForNextLevel();

        if (this.totalWarps >= requiredForNext && this.squadLevel < 20) {
            this.squadLevel++;
            this.log(`🌟 SQUAD LEVEL UP! Now Level ${this.squadLevel} (Max Runners: ${this.getMaxRunners()})`);
        }

        runner.warp();
        this.save();
    }

    sendRunner(runner) {
        if (runner.state === "READY") {
            runner.startRun();
            this.log(`🚀 ${runner.name} sent to Zone 1`);
            this.save();
        }
    }

    sendAllRunners() {
        let sentCount = 0;
        this.runners.forEach(r => {
            if (r.state === "READY") {
                r.startRun();
                sentCount++;
            }
        });
        if (sentCount > 0) {
            this.log(`🚀 ${sentCount} Runner${sentCount > 1 ? 's' : ''} sent to Zone 1`);
            this.save();
        }
    }

    spawnNPC(targetZoneIndex) {
        let id = Date.now() + Math.random();
        let name = NPC_NAME;
        let runner = new Runner(id, name, true);
        runner.targetZone = targetZoneIndex;
        runner.startRun();
        this.runners.push(runner);
        this.log(`🚧 NPC Team deployed for Zone ${targetZoneIndex+1}`);
    }

    generateNextMapSegment() {
        let idx;
        if (this.mapSegments.length === 0) {
            idx = 0;
        } else {
            let availablePatterns = [1, 2, 3, 4].filter(i => i !== this.activePatternIndex);
            idx = availablePatterns[Math.floor(Math.random() * availablePatterns.length)];
        }
        this.activePatternIndex = idx;
        let prevEnv = this.mapSegments.length > 0 ? this.mapSegments[this.mapSegments.length - 1].environment : null;
        let segment = new MapSegment(this.mapSegments.length, MAP_PATTERNS[idx], prevEnv);
        this.mapSegments.push(segment);
    }

    manageUpgradeQueue() {
        // Every 5th level allows +1 concurrently
        const maxConcurrent = 1 + Math.floor(this.squadLevel / 5);

        const upgradingRunners = this.runners.filter(r => r.state === "UPGRADING");
        const activeCount = upgradingRunners.length;

        if (activeCount < maxConcurrent) {
            const slots = maxConcurrent - activeCount;
            const queued = this.runners.filter(r => r.state === "QUEUED");

            if (queued.length > 0) {
                // Sort by Warp Timestamp (First In), then by Base DPS (Tie breaker)
                queued.sort((a, b) => {
                    if (a.warpTimestamp !== b.warpTimestamp) return a.warpTimestamp - b.warpTimestamp;
                    return a.baseDPS - b.baseDPS;
                });

                for (let i = 0; i < slots && i < queued.length; i++) {
                    const r = queued[i];
                    r.state = "UPGRADING";
                    this.log(`${r.name} started upgrading (Queue Position: ${i+1})`);
                }
            }
        }
    }

    updateRunnerList() {
        this.renderRunnerManagement();
    }

    getWarpsRequiredForNextLevel() {
        // Sum 10 * i for i=1 to currentLevel + 1
        let total = 0;
        for (let i = 1; i <= this.squadLevel + 1; i++) total += i * 10;
        return total;
    }

    renderRunnerManagement() {
        const container = document.getElementById('runner-list-container');
        if (!container) return;
        container.innerHTML = '';

        // Update Header
        const visibleRunners = this.runners.filter(r => !r.isNPC);
        const readyCount = visibleRunners.filter(r => r.state === "READY").length;
        const upgradingCount = visibleRunners.filter(r => r.state === "UPGRADING").length;
        const runningCount = visibleRunners.filter(r => r.state === "RUNNING").length;

        let required = this.getWarpsRequiredForNextLevel();
        let remaining = Math.max(0, required - this.totalWarps);
        let warpsText = (this.squadLevel >= 20) ? "Max Level" : `Warps: ${remaining}`;

        document.getElementById('squad-level-display').innerHTML = `Squad Level ${this.squadLevel} <span style="font-size:0.7em; margin-left:10px; color:#aaa;">(${warpsText})</span>`;
        document.getElementById('squad-counts').textContent = `Ready: ${readyCount} | Upgrading: ${upgradingCount} | On Run: ${runningCount}`;

        // Sort:
        // 1. Ready (DPS Desc)
        // 2. Upgrading (Closest to done)
        // 3. Queued (Warp Time Asc)
        // 4. Running (Durability Desc)

        let sorted = [...visibleRunners].sort((a, b) => {
             const priorities = { "READY": 0, "UPGRADING": 1, "QUEUED": 2, "RUNNING": 3 };
             let pA = priorities[a.state];
             let pB = priorities[b.state];
             if (pA !== pB) return pA - pB;

             if (a.state === "READY") {
                 return b.baseDPS - a.baseDPS;
             }
             if (a.state === "UPGRADING") {
                 // Sort by how much is left to process? Less left = First
                 let remA = (a.currentUpgrade ? a.currentUpgrade.remaining : 0) + a.upgradeQueue.reduce((s,t) => s + t.remaining, 0);
                 let remB = (b.currentUpgrade ? b.currentUpgrade.remaining : 0) + b.upgradeQueue.reduce((s,t) => s + t.remaining, 0);
                 return remA - remB;
             }
             if (a.state === "QUEUED") {
                 // Sort by timestamp
                 if (a.warpTimestamp !== b.warpTimestamp) return a.warpTimestamp - b.warpTimestamp;
                 return a.baseDPS - b.baseDPS;
             }
             if (a.state === "RUNNING") {
                 // Closest to durability cap (Percentage filled)
                 let pA = a.durability / a.getCap();
                 let pB = b.durability / b.getCap();
                 return pB - pA;
             }
             return 0;
        });

        sorted.forEach(r => {
            const card = document.createElement('div');
            card.className = `runner-card state-${r.state.toLowerCase()}`;

            // Current Action Data
            let isUpgrading = r.state === "UPGRADING";
            let isQueued = r.state === "QUEUED";
            let upgradeType = (isUpgrading && r.currentUpgrade) ? r.currentUpgrade.type : null;
            let currentUpgradeRelic = (isUpgrading && r.currentUpgrade && r.currentUpgrade.type === 'RELIC') ? r.currentUpgrade.relicType : null;

            // Stats Colors
            let dpsClass = ((isUpgrading || isQueued) && upgradeType === 'DPS') ? 'text-green' : 'text-white';
            let zpClass = ((isUpgrading || isQueued) && upgradeType === 'DPS') ? 'text-red' : 'text-white';
            let fragClass = ((isUpgrading || isQueued) && upgradeType === 'RELIC') ? 'text-red' : 'text-white';

            // For queued, we don't have currentUpgrade set yet, so upgradeType is null.
            // But we do know what's in the queue.
            // If queued, we show pending stats.

            let displayZP = r.zpCollected;
            let displayFrags = 0;

            if (isUpgrading || isQueued) {
                // Show ZP remaining in queue
                let pendingZP = r.upgradeQueue.filter(t => t.type === 'DPS').reduce((sum, t) => sum + t.remaining, 0);
                if (r.currentUpgrade && r.currentUpgrade.type === 'DPS') pendingZP += r.currentUpgrade.remaining;
                displayZP = pendingZP;

                // Show fragments remaining in queue
                let pendingFrags = r.upgradeQueue.filter(t => t.type === 'RELIC').reduce((sum, t) => sum + t.remaining, 0);
                if (r.currentUpgrade && r.currentUpgrade.type === 'RELIC') pendingFrags += r.currentUpgrade.remaining;
                displayFrags = pendingFrags;
            } else {
                 displayFrags = Object.values(r.fragmentsCollected).reduce((a,b)=>a+b, 0);
            }

            // Build Relic Grid
            let relicsHtml = '<div class="relic-grid-container">';
            RELIC_TYPES.forEach(type => {
                let val = r.relics[type] || 0;
                let abbrev = RELIC_ABBREVS[type];
                let banked = r.fragments[type] || 0;
                let cost = RELIC_UPGRADE_BASE_COST + (val * RELIC_UPGRADE_COST_PER_TIER);
                let needed = Math.max(0, cost - banked);

                let cellClass = 'text-white';
                if (currentUpgradeRelic === type) {
                    cellClass = 'text-green upgrading-relic';
                }

                // New Logic:
                // Default: STR | T1 (Hide needed)
                // Upgrading (Active): T1 | 13 (Hide Name, show needed)
                let cellContent = "";
                if (currentUpgradeRelic === type) {
                    // Active Upgrade
                    cellContent = `T${val}|${Math.floor(needed)}`;
                } else {
                    // Default
                    cellContent = `${abbrev}|T${val}`;
                }

                relicsHtml += `<div class="relic-cell ${cellClass}">${cellContent}</div>`;
            });
            relicsHtml += '</div>';

            // Upgrading Bar Logic
            let upgradeHtml = '';
            if (isUpgrading) {
                let current = r.currentUpgrade;
                if (current) {
                    let pct = 100 - (current.remaining / current.total * 100);
                    let label = current.type === 'DPS' ? "Upgrading DPS" : "Upgrading Relics";

                    upgradeHtml = `
                        <div class="upgrade-progress-container">
                            <div class="upgrade-bar" style="width: ${pct}%"></div>
                        </div>
                        <div class="upgrade-text">${label}</div>
                    `;
                } else {
                     upgradeHtml = `<div class="upgrade-text">Finalizing...</div>`;
                }
            } else if (isQueued) {
                 upgradeHtml = `<div class="upgrade-text" style="color:#bbb; margin-top:8px;">Waiting in queue...</div>`;
            }

            let sendBtn = '';
            if (r.state === "READY") {
                sendBtn = `<button class="send-btn" onclick="game.sendRunnerById(${r.id})">SEND</button>`;
            }

            // Status Badge & Icon
            let statusText = r.state;
            let icon = r.getEmoji();
            if (r.state === "RUNNING") statusText = "ON RUN";
            if (r.state === "UPGRADING") icon = "🔧";
            if (r.state === "QUEUED") icon = "🔧";

            card.innerHTML = `
                <div class="runner-header">
                    <span class="runner-name">${icon} ${r.name}</span>
                    <span class="runner-state state-${r.state.toLowerCase()}">${statusText}</span>
                </div>
                <div class="runner-stats-4-col">
                    <div>DPS: <span class="${dpsClass}">${formatLargeNumber(r.baseDPS)}</span></div>
                    <div>ZP: <span class="${zpClass}">${formatLargeNumber(displayZP)}</span></div>
                    <div>Frags: <span class="${fragClass}">${formatLargeNumber(displayFrags)}</span></div>
                    <div>DUR: <span class="text-white">${Math.floor(r.durability)}/${r.getCap()}</span></div>
                </div>
                ${relicsHtml}
                ${upgradeHtml}
                ${sendBtn}
            `;
            container.appendChild(card);
        });
    }

    sendRunnerById(id) {
        let r = this.runners.find(r => r.id === id);
        if (r) this.sendRunner(r);
    }

    updateTracker() {
        const container = document.getElementById('tracker-list');
        container.innerHTML = '';
        const activeRunners = this.runners.filter(r => r.state === "RUNNING" || r.isNPC);

        if (activeRunners.length === 0) {
             const embed = document.createElement('div');
             embed.className = 'tracker-embed';
             embed.innerHTML = `<div class="tracker-embed-header">🏁 THE TRACKER 🏁</div><div class="tracker-embed-description">No runners currently active.</div>`;
             container.appendChild(embed);
             return;
        }

        let caravans = {};
        activeRunners.forEach(r => {
            let key = `${r.globalLevel}`;
            if (!caravans[key]) caravans[key] = [];
            caravans[key].push(r);
        });

        let entities = [];
        for (let key in caravans) {
            let group = caravans[key];

            group.sort((a, b) => {
                if (a.isNPC && !b.isNPC) return -1;
                if (!a.isNPC && b.isNPC) return 1;
                let sA = a.relicsSnapshot["STYLE"] || 0;
                let sB = b.relicsSnapshot["STYLE"] || 0;
                return sB - sA;
            });

            let leader = group[0];
            let currentZone = Math.floor(leader.globalLevel / LEVELS_PER_ZONE);

            let zonePieces = this.mapPieces[currentZone] || [];
            let isMapped = zonePieces.length === 100 && zonePieces.every(Boolean);

            // Calculate accumulated supply bonus from runners strictly ahead
            let supplyBonusFromAhead = 0;
            activeRunners.forEach(other => {
                // Bonus comes from runners strictly ahead and not NPCs
                if (other.globalLevel > leader.globalLevel && !other.isNPC) {
                    const supplyTier = other.relicsSnapshot["SUPPLY"] || 0;
                    supplyBonusFromAhead += (supplyTier * SUPPLY_RELIC_BONUS);
                }
            });

            let totalDPS = group.reduce((sum, r) => sum + r.getEffectiveDPS(group.length, supplyBonusFromAhead, this.highestReachedZone, isMapped), 0);

            if (group.length > 1) {
                entities.push({ type: "caravan", zone: Math.floor((leader.globalLevel - 1) / LEVELS_PER_ZONE) + 1, level: leader.levelInZone, wave: leader.wave, hp: leader.barrierHealth, dps: totalDPS, members: group, globalLevel: leader.globalLevel });
            } else {
                entities.push({ type: "runner", zone: Math.floor((leader.globalLevel - 1) / LEVELS_PER_ZONE) + 1, level: leader.levelInZone, wave: leader.wave, hp: leader.barrierHealth, dps: totalDPS, runner: leader, globalLevel: leader.globalLevel });
            }
        }

        entities.sort((a, b) => {
            if (a.globalLevel !== b.globalLevel) return b.globalLevel - a.globalLevel;
            return b.wave - a.wave;
        });

        const embed = document.createElement('div');
        embed.className = 'tracker-embed';
        const header = document.createElement('div');
        header.className = 'tracker-embed-header';
        header.textContent = "🏁 THE TRACKER 🏁";
        embed.appendChild(header);
        const description = document.createElement('div');
        description.className = 'tracker-embed-description';

        let runnersCount = activeRunners.filter(r => !r.isNPC).length;
        let npcCount = activeRunners.filter(r => r.isNPC).length;
        let descText = `Runners: ${runnersCount}`;
        if (npcCount > 0) descText += ` | NPCs: ${npcCount}`;

        description.textContent = descText;
        embed.appendChild(description);

        entities.slice(0, 20).forEach(entity => {
            const field = document.createElement('div');
            field.className = 'tracker-field';
            let maxWaves = this.getWavesForLevel(entity.globalLevel);
            let estTime = this.calculateLevelCompletionTime(entity, maxWaves);
            let hpFormatted = formatLargeNumber(Math.max(0, entity.hp));
            let dpsFormatted = formatLargeNumber(entity.dps);
            let barrierType = "";
            if (entity.wave === maxWaves) {
                if (entity.level === LEVELS_PER_ZONE) {
                    if (this.activeHideouts.has(entity.zone - 1)) {
                        barrierType = " | HIDEOUT";
                    } else {
                        barrierType = " | ZONE BOSS";
                    }
                }
                else if (entity.level % 10 === 0) barrierType = " | BOSS";
            }

            if (entity.type === "caravan") {
                let memberEmojis = entity.members.map(m => `${m.getEmoji()} ${m.name}`).join(" ");
                field.innerHTML = `<div class="tracker-field-name">Caravan (${entity.members.length} members)</div>
                    <div class="tracker-field-value">Z: ${entity.zone} | L: ${entity.level} | W: ${entity.wave}/${maxWaves}${barrierType} | B: ${hpFormatted} | CDPS: ${dpsFormatted} | Est: ${estTime}</div>
                    <div class="tracker-field-value">${memberEmojis}</div>`;
            } else {
                let r = entity.runner;
                let name = `${r.getEmoji()}${r.name}`;
                field.innerHTML = `<div class="tracker-field-name">${name}</div>
                    <div class="tracker-field-value">Z: ${entity.zone} | L: ${entity.level} | W: ${entity.wave}/${maxWaves}${barrierType} | B: ${hpFormatted} | DPS: ${dpsFormatted} | Est: ${estTime}</div>`;
            }
            embed.appendChild(field);
        });
        container.appendChild(embed);
    }

    updateMapProgressDisplay() {
        const container = document.getElementById('map-progress-container');
        if (!container) return;

        let zonesContainer = document.getElementById('map-zones-list');
        let summaryContainer = document.getElementById('map-summary-fixed');

        if (!zonesContainer) {
            container.innerHTML = '';
            zonesContainer = document.createElement('div');
            zonesContainer.id = 'map-zones-list';
            container.appendChild(zonesContainer);

            summaryContainer = document.createElement('div');
            summaryContainer.id = 'map-summary-fixed';
            container.appendChild(summaryContainer);
        }

        zonesContainer.innerHTML = '';
        summaryContainer.innerHTML = '';

        let inProgressMaps = 0;
        let completedMaps = 0;
        let completedZonesCount = 0;
        let allZoneIndices = Object.keys(this.mapPieces).map(k => parseInt(k));
        let maxZone = Math.max(...allZoneIndices, this.highestReachedZone, 0);

        for (let z = 0; z <= maxZone; z++) {
             let pieces = this.mapPieces[z] || Array(100).fill(false);
             let total = pieces.filter(Boolean).length;
             if (total === 100) completedZonesCount++;
             for(let t=0; t<10; t++) {
                 let start = t * 10;
                 let end = start + 10;
                 let p = pieces.slice(start, end).filter(Boolean).length;
                 if (p === 10) completedMaps++;
                 else if (p > 0) inProgressMaps++;
             }
        }

        for (let z = maxZone; z >= 0; z--) {
            if (this.conqueredZones.includes(z)) continue;

            let pieces = this.mapPieces[z] || Array(100).fill(false);
            let total = pieces.filter(Boolean).length;

            if (total === 0 && z < maxZone) { }

            let div = document.createElement('div');
            div.className = 'map-progress-zone';
            let status = "Mapping...";
            if (total >= 100) status = "Mapped!";

            let html = `<div class="map-progress-header">Zone ${z+1} - ${status}</div><div class="map-progress-grid">`;
            for(let t=0; t<10; t++) {
                 let start = t * 10;
                 let end = start + 10;
                 let p = pieces.slice(start, end).filter(Boolean).length;

                 let color = "#555";
                 if(p > 0) color = "orange";
                 if(p == 10) color = "#8B4513";

                 let label = (t + 1) === 10 ? "SX" : `S${t+1}`;
                 html += `<div style="color:${color}">${label}: ${p}/10</div>`;
            }
            html += `</div>`;
            div.innerHTML = html;
            zonesContainer.appendChild(div);
        }

        let conqueredIndices = new Set(this.conqueredZones);
        this.runners.forEach(r => {
            if (r.isNPC) conqueredIndices.add(r.targetZone);
        });

        let conqueredList = Array.from(conqueredIndices).sort((a,b)=>a-b);
        let roadList = [...this.conqueredZones].sort((a,b)=>a-b);

        let completedMapsDPS = completedMaps * 5;
        let completedZonesDPS = completedZonesCount * 50;

        let summaryHtml = `
            <div class="map-progress-zone" style="border-top: 2px solid #444; margin-top: 10px; padding-top: 10px; margin-bottom: 0;">
                <div class="map-progress-header" style="text-align:center; color:#fff;">Overall Map Progress</div>
                <div style="font-size: 0.9em; line-height: 1.4em;">
                    <div>In Progress Maps: ${inProgressMaps}</div>
                    <div>Completed Maps: ${completedMaps} (+${completedMapsDPS} DPS)</div>
                    <div>Completed Zones: ${completedZonesCount} (+${completedZonesDPS} DPS)</div>
                    <div>Conquered Zones: ${formatRange(conqueredList)}</div>
                    <div>Constructed Roads: ${formatRange(roadList)}</div>
                </div>
            </div>
        `;
        summaryContainer.innerHTML = summaryHtml;
    }

    renderMap() {
        const container = document.getElementById('map-content');
        container.innerHTML = '';
        let maxSeg = 0;
        let activeRunners = this.runners.filter(r => r.state === "RUNNING" || r.isNPC);
        if (activeRunners.length > 0) {
            maxSeg = activeRunners.reduce((max, r) => Math.max(max, r.currentSegmentIndex), 0);
        }
        let visibleLimit = Math.max(maxSeg + 1, 1);
        let currentGlobalTileOffset = 0;

        let npcs = this.runners.filter(r => r.isNPC);

        for (let i = 0; i < this.mapSegments.length; i++) {
            if (i > visibleLimit) break;
            let seg = this.mapSegments[i];
            let segRunners = activeRunners.filter(r => r.currentSegmentIndex === seg.index);
            let exploredStep = this.maxStepPerSegment[i] !== undefined ? this.maxStepPerSegment[i] : (i < maxSeg ? 9999 : -1);

            const div = document.createElement('div');
            div.className = 'map-segment';
            div.innerHTML = seg.render(segRunners, this.conqueredZones, exploredStep, currentGlobalTileOffset, this.mapPieces, this.activeHideouts, npcs);
            container.appendChild(div);
            currentGlobalTileOffset += seg.pathCoordinates.length;
        }
    }

    formatTime(seconds) {
        if (seconds === Infinity) return "∞";
        if (seconds < 60) return `${seconds}s`;
        if (seconds < 3600) {
            let m = Math.floor(seconds / 60);
            let s = seconds % 60;
            return `${m}m${s}s`;
        }
        let h = Math.floor(seconds / 3600);
        let rem = seconds % 3600;
        let m = Math.floor(rem / 60);
        let s = rem % 60;
        return `${h}h${m}m${s}s`;
    }

    calculateLevelCompletionTime(entity, maxWaves) {
        if (entity.dps <= 0) return "∞";
        let totalSeconds = 0;

        // 1. Current Wave
        totalSeconds += Math.ceil(entity.hp / entity.dps);

        // 2. Future Waves
        for (let w = entity.wave + 1; w <= maxWaves; w++) {
            let hp = this.calculateBarrierHealth(entity.globalLevel, w);
            totalSeconds += Math.ceil(hp / entity.dps);
        }

        return this.formatTime(totalSeconds);
    }

    calculateEstimatedCompletionTime(dps, currentHP) {
        // Deprecated but kept if needed, redirected to formatTime
        if (dps <= 0) return "∞";
        return this.formatTime(Math.ceil(currentHP / dps));
    }

    save() {
        const data = {
            squadLevel: this.squadLevel,
            totalWarps: this.totalWarps,
            runners: this.runners.filter(r=>!r.isNPC).map(r => ({
                id: r.id, name: r.name,
                baseDPS: r.baseDPS,
                relics: r.relics,
                fragments: r.fragments,

                state: r.state,
                upgradeQueue: r.upgradeQueue,
                currentUpgrade: r.currentUpgrade,

                zpCollected: r.zpCollected,
                durability: r.durability,
                fragmentsCollected: r.fragmentsCollected,

                // Run snapshot
                zone: r.zone,
                levelInZone: r.levelInZone,
                globalLevel: r.globalLevel,
                wave: r.wave,
                barrierHealth: r.barrierHealth,
                currentSegmentIndex: r.currentSegmentIndex,
                stepInSegment: r.stepInSegment,
                dps: r.dps,
                relicsSnapshot: r.relicsSnapshot,
                mapBonusesApplied: Array.from(r.mapBonusesApplied),
                zoneBonusesApplied: Array.from(r.zoneBonusesApplied)
            })),
            activePatternIndex: this.activePatternIndex,
            highestReachedZone: this.highestReachedZone,
            mapPieces: this.mapPieces,
            mapPieceBoosts: this.mapPieceBoosts,
            completedMaps: this.completedMaps,
            conqueredZones: this.conqueredZones,
            maxStepPerSegment: this.maxStepPerSegment,
            zonesReadyForHideout: Array.from(this.zonesReadyForHideout),
            activeHideouts: Array.from(this.activeHideouts),
            pendingRoads: Array.from(this.pendingRoads)
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    }

    load() {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) {
            try {
                const data = JSON.parse(raw);
                this.squadLevel = data.squadLevel || 0;
                this.totalWarps = data.totalWarps || 0;

                this.activePatternIndex = data.activePatternIndex || -1;
                this.highestReachedZone = data.highestReachedZone || 0;
                this.mapPieces = data.mapPieces || {};
                this.mapPieceBoosts = data.mapPieceBoosts || {};
                this.completedMaps = data.completedMaps || {};
                this.conqueredZones = data.conqueredZones || [];
                this.maxStepPerSegment = data.maxStepPerSegment || {};

                if (data.zonesReadyForHideout) this.zonesReadyForHideout = new Set(data.zonesReadyForHideout);
                if (data.activeHideouts) this.activeHideouts = new Set(data.activeHideouts);
                if (data.pendingRoads) this.pendingRoads = new Set(data.pendingRoads);

                if (data.runners) {
                    this.runners = data.runners.map(d => {
                        let r = new Runner(d.id, d.name, false);
                        r.baseDPS = d.baseDPS || RUNNER_STARTING_DPS;
                        r.relics = d.relics || r.relics;
                        r.fragments = d.fragments || r.fragments;

                        r.state = d.state || "READY";
                        r.upgradeQueue = d.upgradeQueue || [];
                        r.currentUpgrade = d.currentUpgrade || null;
                        r.warpTimestamp = d.warpTimestamp || 0;

                        r.zpCollected = d.zpCollected || 0;
                        r.durability = d.durability !== undefined ? d.durability : (d.fatigue || 0);
                        r.fragmentsCollected = d.fragmentsCollected || r.fragmentsCollected;

                        // Run Snapshot
                        r.zone = d.zone || 0;
                        r.levelInZone = d.levelInZone || 1;
                        r.globalLevel = d.globalLevel || 1;
                        r.wave = d.wave || 1;
                        r.barrierHealth = d.barrierHealth || DEFAULT_BARRIER_HEALTH;
                        r.currentSegmentIndex = d.currentSegmentIndex || 0;
                        r.stepInSegment = d.stepInSegment || 0;
                        r.dps = d.dps || RUNNER_STARTING_DPS;
                        r.relicsSnapshot = d.relicsSnapshot || r.relics;
                        r.mapBonusesApplied = new Set(d.mapBonusesApplied || []);
                        r.zoneBonusesApplied = new Set(d.zoneBonusesApplied || []);

                        return r;
                    });
                }
            } catch (e) {
                console.error("Save load failed", e);
            }
        }
    }

    resetSave() {
        if (this.loopId) clearInterval(this.loopId);
        if (this.saveLoopId) clearInterval(this.saveLoopId);
        this.loopId = null;
        localStorage.removeItem(SAVE_KEY);
        location.reload();
    }
}

const game = new GameState();
document.getElementById('send-all-btn').addEventListener('click', () => { game.sendAllRunners(); });
document.getElementById('reset-save-btn').addEventListener('click', () => { if(confirm("Reset all progress?")) { game.resetSave(); }});
game.start();
