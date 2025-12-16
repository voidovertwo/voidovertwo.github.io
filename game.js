// Constants
const BASE_ZP_CAP = 40;
const COST_BASE = 100;
const COST_MULTIPLIER = 1.1;
const UPDATE_INTERVAL = 1000; // 1 second
const SAVE_INTERVAL = 60000; // 60 seconds
const SAVE_KEY = "zonerunners_save_v1";
const DEFAULT_BARRIER_HEALTH = 10;
const WAVES_PER_LEVEL = 10;
const LEVELS_PER_TILE = 10; // Changed from 50 to 10
const LEVELS_PER_ZONE = 100;
const BOSS_HEALTH_MULTIPLIER = 50;
const ZONE_BOSS_HEALTH_MULTIPLIER = 250;
const BANDIT_HIDEOUT_HEALTH_MULTIPLIER = 1000;

const RELIC_TYPES = [
    "STRENGTH", "SCOOP", "STEAL", "SIDEKICK",
    "SPEED", "STYLE", "SUPPLY", "SCAN"
];

const STYLE_EMOJIS = {
    0: "🛺", 2: "🚗", 4: "🛻", 6: "🚕", 8: "🚓",
    10: "🚙", 12: "🚑", 14: "🚐", 16: "🚚", 18: "🚌", 20: "🚛"
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
    const suffixNum = Math.floor(("" + Math.floor(num)).length / 3);
    // Correct for cases like 100,000 where length is 6 but should use suffix index 1 (K)
    // Actually, simpler logic:
    // < 1M (6 digits) -> K
    // < 1B (9 digits) -> M
    const tier = Math.floor(Math.log10(num) / 3);
    if (tier === 0) return Math.floor(num);

    const suffix = suffixes[tier];
    const scale = Math.pow(10, tier * 3);
    const scaled = num / scale;

    return scaled.toFixed(1) + suffix;
}

class Runner {
    constructor(id, name, dps, globalRelics) {
        this.id = id;
        this.name = name;
        this.dps = dps;

        // Relic Snapshot
        this.relicsSnapshot = { ...globalRelics };

        // Position
        this.zone = 0; // Current Zone Index (0-based)
        this.levelInZone = 1; // 1 to 100

        this.globalLevel = 1; // Total levels cleared across all zones (for stats/logic)

        this.wave = 1;

        this.barrierHealth = DEFAULT_BARRIER_HEALTH;
        this.zpCollected = 0;
        this.fragmentsCollected = {};

        RELIC_TYPES.forEach(t => this.fragmentsCollected[t] = 0);

        this.isWarping = false;

        // NPC Flag
        this.isNPC = false;
        this.targetZone = 0; // For NPC
    }

    getEffectiveDPS(caravanSize, runnersAhead, highestReachedZone, constructedRoads, mapCompleted) {
        let eff = this.dps;
        const relics = this.relicsSnapshot;

        if (caravanSize > 1) {
            const sidekick = relics["SIDEKICK"] || 0;
            eff *= (1 + (sidekick * 0.025));
        }

        if (runnersAhead > 0) {
            const supply = relics["SUPPLY"] || 0;
            eff *= (1 + (runnersAhead * supply * 0.005));
        }

        // SPEED Bonus: Only if current zone has a constructed road
        // The original logic was "if zone < highestReachedZone" which was a proxy for "explored"
        // But typically SPEED applies on roads. Python: "if self.zone in game_state.constructed_roads"
        let currentZone = Math.floor((this.globalLevel - 1) / LEVELS_PER_ZONE);
        // Note: constructedRoads is a Set or Array of zone indices
        let hasRoad = false;
        if (Array.isArray(constructedRoads)) {
             hasRoad = constructedRoads.includes(currentZone);
        } else if (constructedRoads instanceof Set) {
             hasRoad = constructedRoads.has(currentZone);
        }

        if (hasRoad) {
            const speed = relics["SPEED"] || 0;
            eff *= (1 + (speed * 0.025));
        }

        // Map Completion Bonus logic is handled per segment/tile usually,
        // but here we might simplify or assume passed in correctly.
        // Original JS passed `this.completedMaps[currentZone]` which was per-zone.
        // Python has per-tile (Set) bonus.
        // We will stick to the calling logic to pass mapCompleted.
        // Ideally mapCompleted should be true if the specific TILE the runner is on is complete.
        if (mapCompleted) {
            eff += 5;
        }

        // Zone Conquest Bonus (Python: +50 DPS if zone is fully completed)
        // We'll leave this to be added to Base DPS or handled here if passed.
        // For now, Python adds it to base DPS upon zone completion.

        return eff;
    }

    getDPSGain() {
        let base = 0.5;
        const str = this.relicsSnapshot["STRENGTH"] || 0;
        return base + (str * 0.1);
    }

    getCap() {
        if (this.isNPC) return Infinity; // NPC has no cap
        const style = this.relicsSnapshot["STYLE"] || 0;
        return BASE_ZP_CAP + (style * 4);
    }

    getEmoji() {
        if (this.isNPC) return "🚧";
        const tier = this.relicsSnapshot["STYLE"] || 0;
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

        // Each segment is roughly 40 tiles. With 1 Zone = 10 Tiles (100 levels / 10 levels per tile),
        // 1 Segment = ~4 Zones.

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

        let path = [];
        let visited = new Set();
        let current = nodes[0];

        // Specific override for Segment 0 to start at (7, 2)
        if (this.index === 0) {
            let startNode = nodes.find(n => n.x === 7 && n.y === 2);
            if (startNode) {
                current = startNode;
            }
        }

        while (current) {
            path.push(current);
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
        this.pathCoordinates = path;
    }

    render(runnersOnThisSegment = [], conqueredZones = [], mapPieces = {}, globalTileOffset = 0, npc = null, activeHideouts = new Set(), zonesReadyForHideout = new Set(), maxStepExplored = -1) {
        let visualGrid = this.grid.map(row => [...row]);

        let visibleSet = new Set();

        // Always reveal Oasis area in Segment 0
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
                // Reveal immediate neighbors (3x3 area)
                for(let dy=-1; dy<=1; dy++){
                    for(let dx=-1; dx<=1; dx++){
                        visibleSet.add(`${p.x + dx},${p.y + dy}`);
                    }
                }
            }
        }

        let mapPosCounts = {};
        runnersOnThisSegment.forEach(runner => {
            if (runner.stepInSegment < this.pathCoordinates.length) {
                let pos = this.pathCoordinates[runner.stepInSegment];
                let key = `${pos.x},${pos.y}`;
                if(!mapPosCounts[key]) mapPosCounts[key] = [];
                mapPosCounts[key].push(runner);
            }
        });

        // Check for NPC on this segment
        if (npc && npc.isNPC && npc.currentSegmentIndex === this.index) {
             if (npc.stepInSegment < this.pathCoordinates.length) {
                let pos = this.pathCoordinates[npc.stepInSegment];
                let key = `${pos.x},${pos.y}`;
                if(!mapPosCounts[key]) mapPosCounts[key] = [];
                mapPosCounts[key].push(npc);
            }
        }

        for (let y = 0; y < visualGrid.length; y++) {
            for (let x = 0; x < visualGrid[y].length; x++) {
                let key = `${x},${y}`;

                if (!visibleSet.has(key)) {
                    visualGrid[y][x] = "☁️";
                    continue;
                }

                // Render Runners / NPC priority
                if (mapPosCounts[key]) {
                    // Check if NPC is in the group
                    let hasNPC = mapPosCounts[key].some(r => r.isNPC);
                    if (hasNPC) {
                        visualGrid[y][x] = "🚧";
                    } else {
                        visualGrid[y][x] = mapPosCounts[key][0].getEmoji();
                    }
                    continue; // Skip terrain logic if runner is here
                }

                // If it's a path tile ('⬛')
                if (visualGrid[y][x] === '⬛') {
                    // Identify which Global Tile this is
                    let pathIdx = this.pathCoordinates.findIndex(p => p.x === x && p.y === y);

                    if (pathIdx !== -1) {
                        let globalTileIndex = globalTileOffset + pathIdx;
                        // 1 Tile = 10 Levels.
                        // Zone 0 (Levels 1-100) = Tiles 0-9.
                        // Zone 1 = Tiles 10-19.
                        let zoneForTile = Math.floor(globalTileIndex / 10);

                        // Default to environment (hidden path)
                        // Use a consistent environment char based on position to avoid flickering
                        let envChar = this.environment[Math.floor((x + y) % this.environment.length)];

                        visualGrid[y][x] = envChar;

                        // 1. Check Road Constructed
                        let roadIsBuilt = false;

                        // Case A: Zone is fully constructed
                        if (conqueredZones.includes(zoneForTile)) {
                            roadIsBuilt = true;
                        }

                        // Case B: Progressive Construction by NPC
                        // If NPC is targeting this zone, check if it has passed this tile
                        if (!roadIsBuilt && npc && npc.isNPC && npc.targetZone === zoneForTile) {
                            // Calculate the global level required to complete this tile
                            // Tile 0 -> Levels 1-10. Complete at > 10.
                            // Global Tile Index 0 -> End Level 10.
                            // Global Tile Index T -> End Level (T+1)*10.
                            let tileEndLevel = (globalTileIndex + 1) * 10;
                            if (npc.globalLevel > tileEndLevel) {
                                roadIsBuilt = true;
                            }
                        }

                        if (roadIsBuilt) {
                             visualGrid[y][x] = "⬛"; // Black square for Road
                        }
                        // 2. Check Map Piece Found
                        // mapPieces is { tileIndex: boolean/count }?
                        // If map piece for this globalTileIndex is found -> Show Orange/Brown
                        else if (mapPieces[globalTileIndex]) {
                            // Check "Partial" vs "Full" ?
                            // Python: Orange for <=50%, Brown for >50%.
                            // Here a "Tile" is 10 levels.
                            // If `mapPieces[globalTileIndex]` implies "Unlocked", we show Brown.
                            visualGrid[y][x] = "🟫";
                        }

                        // 3. Hideout / Boss Emojis?
                        // Python puts emojis on the map for specific milestones.
                        // e.g. Zone Boss at end of zone.
                        // End of Zone = 10th Tile (index 9, 19, 29...)
                        if ((globalTileIndex + 1) % 10 === 0) {
                            if (activeHideouts.has(zoneForTile)) {
                                visualGrid[y][x] = "🏰"; // Hideout
                            } else if (zonesReadyForHideout.has(zoneForTile)) {
                                // Maybe waiting for clear?
                            } else if (!conqueredZones.includes(zoneForTile)) {
                                // Standard Zone Boss (hidden by environment usually?)
                                // Python: "If area explored... return Castle/House/etc"
                                // If map piece found, we show Brown.
                                // If it's a boss tile and visible (Brown/Black), maybe overlay boss?
                                // For now keep simple.
                            }
                        }
                    } else {
                        // Should be environment
                         let envChar = this.environment[Math.floor((x + y) % this.environment.length)];
                         visualGrid[y][x] = envChar;
                    }
                }
            }
        }

        return visualGrid.map(row => row.join('')).join('\n');
    }
}

class GameState {
    constructor() {
        this.globalZP = 1000;
        this.runnersSentCount = 0;
        this.runners = [];
        this.relics = {};
        this.relicFragments = {};

        this.mapSegments = [];
        this.activePatternIndex = -1;

        this.highestReachedZone = 0;
        this.mapPieces = {}; // { globalTileIndex: true } - Tracks collected map tiles
        this.completedMaps = {}; // { zoneIndex: true } - Tracks fully completed zones

        // New State Variables
        this.conqueredZones = []; // Zones where Hideout is defeated (Road might not be built)
        this.constructedRoads = []; // Zones where NPC has finished building road
        this.activeHideouts = new Set(); // Zones with active Bandit Hideout
        this.zonesReadyForHideout = new Set(); // Zones waiting for players to leave to spawn Hideout
        this.npc = null; // NPC Runner Object

        this.maxStepPerSegment = {};

        RELIC_TYPES.forEach(type => {
            this.relics[type] = 0;
            this.relicFragments[type] = 0;
        });

        this.loopId = null;
        this.saveLoopId = null;
    }

    start() {
        this.load();

        while (this.mapSegments.length < 2) {
            this.generateNextMapSegment();
        }

        // Recovery Logic for NPC
        // If a zone is conquered but road not built, and no NPC exists, spawn one.
        if (!this.npc) {
            let nextTarget = this.findNextConstructionTarget();
            if (nextTarget !== null) {
                // Should we spawn immediately? Or wait?
                // If it was mid-progress, we lost the exact location, so restart at beginning of run.
                this.spawnNPC(nextTarget);
            }
        }

        this.renderRelics();
        this.updateCostDisplay();
        this.updateGlobalZPDisplay();
        this.renderMap();

        this.loopId = setInterval(() => this.update(), UPDATE_INTERVAL);
        this.saveLoopId = setInterval(() => this.save(), SAVE_INTERVAL);
    }

    log(msg) {
        const logContainer = document.getElementById('game-log-content');
        if (!logContainer) return;

        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.textContent = `> ${msg}`;
        logContainer.prepend(entry);

        if (logContainer.children.length > 50) {
            logContainer.lastChild.remove();
        }
    }

    update() {
        // --- NPC Logic ---
        if (this.npc) {
             // NPC travels physically.
             // Assume NPC has high DPS or just moves fixed speed?
             // Python: NPC runs like a player.
             // We can treat NPC as a runner in the update loop but with special logic.
             // Or separate update. Let's merge into runners loop processing if possible,
             // or handle separately.
             // Ideally NPC is just in this.runners but marked isNPC.
             // But we store it in this.npc to easily track it.
             // Let's ensure NPC is in this.runners list for movement logic,
             // but we need to ensure we don't duplicate it.
             // Actually, let's process NPC separately for clarity since it doesn't fight barriers the same way?
             // Python NPC fights barriers.
             // So NPC should be in `this.runners`.
        }

        let allRunners = [...this.runners];
        if (this.npc) allRunners.push(this.npc);

        let sortedRunners = allRunners.sort((a, b) => {
            if (a.zone !== b.zone) return b.zone - a.zone;
            return b.levelInZone - a.levelInZone;
        });

        // Group by Global Level
        let caravans = {};

        allRunners.forEach(r => {
            let key = `${r.globalLevel}`;
            if (!caravans[key]) caravans[key] = [];
            caravans[key].push(r);

            // Fog of War (Max Step)
            if (this.maxStepPerSegment[r.currentSegmentIndex] === undefined || r.stepInSegment > this.maxStepPerSegment[r.currentSegmentIndex]) {
                this.maxStepPerSegment[r.currentSegmentIndex] = r.stepInSegment;
            }
        });

        for (let key in caravans) {
            let group = caravans[key];
            let leader = group[0];

            let runnersAhead = sortedRunners.filter(r => r.globalLevel > leader.globalLevel).length;

            let currentZone = Math.floor(leader.globalLevel / LEVELS_PER_ZONE);

            // Check if Hideout Active at this level
            // Hideout is at the END of a zone (Level 100, 200...)
            let isHideoutLevel = (leader.globalLevel % LEVELS_PER_ZONE === 0);
            let zoneIndex = Math.floor((leader.globalLevel - 1) / LEVELS_PER_ZONE);

            let isHideoutActive = isHideoutLevel && this.activeHideouts.has(zoneIndex);

            // Map Completion Bonus Logic
            // Check if current tile (10 levels) is unlocked
            let currentTileIdx = Math.floor((leader.globalLevel - 1) / LEVELS_PER_TILE);
            let mapCompleted = !!this.mapPieces[currentTileIdx];

            let totalDPS = group.reduce((sum, r) =>
                sum + r.getEffectiveDPS(
                    group.length,
                    runnersAhead,
                    this.highestReachedZone,
                    this.constructedRoads,
                    mapCompleted
                ), 0);

            let barrierHP = leader.barrierHealth;

            // Damage Logic
            barrierHP -= totalDPS;

            if (barrierHP <= 0) {
                // Wave Complete
                leader.wave++;
                let maxWaves = this.getWavesForLevel(leader.globalLevel);

                if (leader.wave > maxWaves) {
                    // Level Complete

                    // Hideout Defeated?
                    if (isHideoutActive) {
                        this.activeHideouts.delete(zoneIndex);
                        this.conqueredZones.push(zoneIndex);
                        this.log(`Bandit Hideout in Zone ${zoneIndex + 1} DEFEATED!`);

                        // Distribute Rewards
                        // (Simplified: Just ZP to everyone in group)
                        group.forEach(r => {
                            if (!r.isNPC) {
                                r.zpCollected += 100 * (zoneIndex + 1);
                                this.log(`${r.name} got Hideout Reward!`);
                            }
                        });

                        // Spawn NPC if not busy
                        if (!this.npc) {
                             this.spawnNPC(zoneIndex);
                        }
                    }

                    // NPC Road Construction Logic
                    if (this.npc && group.includes(this.npc)) {
                        // Check if NPC reached target
                        if (this.npc.globalLevel === (this.npc.targetZone + 1) * LEVELS_PER_ZONE) {
                            // Target Reached
                            this.constructedRoads.push(this.npc.targetZone);
                            this.log(`Road to Zone ${this.npc.targetZone + 1} CONSTRUCTED!`);
                            this.npc = null; // NPC leaves
                            // Check for next target?
                            let nextTarget = this.findNextConstructionTarget();
                            if (nextTarget !== null) {
                                setTimeout(() => this.spawnNPC(nextTarget), 5000);
                            }
                        }
                    }

                    leader.levelInZone++;
                    leader.globalLevel++;
                    leader.wave = 1;

                    // Sync group
                    group.forEach(r => {
                        r.levelInZone = leader.levelInZone;
                        r.globalLevel = leader.globalLevel;
                        r.wave = 1;

                        if (r.isNPC) return; // NPC doesn't collect loot

                        // ZP Reward
                        let completedLevel = leader.globalLevel - 1;
                        let zpGain = 0;
                        if (completedLevel % 10 === 0) zpGain += 1;
                        if (completedLevel % 100 === 0) zpGain += 10;
                        r.zpCollected += zpGain;
                        r.dps += r.getDPSGain();

                        // Steal
                        if (r.globalLevel % 10 === 0) {
                            const stealTier = r.relicsSnapshot["STEAL"] || 0;
                            if (Math.random() < (stealTier * 0.025)) {
                                 r.zpCollected += 1;
                            }
                        }

                        // Fragment
                        if (Math.random() < 0.1) this.awardFragment(r);

                        // Map Piece (Per Tile / 10 Levels)
                        // Current Tile Index = floor((globalLevel - 1) / 10)
                        let tileIdx = Math.floor((r.globalLevel - 1) / 10);
                        if (!this.mapPieces[tileIdx]) {
                            const scanTier = r.relicsSnapshot["SCAN"] || 0;
                            const chance = 0.05 + (scanTier * 0.001); // Base 5% per level in tile
                            if (Math.random() < chance) {
                                // Mark Tile as Found
                                this.mapPieces[tileIdx] = true;
                                this.log(`${r.name} found Map Piece for Tile ${tileIdx}!`);
                            }
                        }
                    });

                    // Check Movement (Every 10 levels/1 Tile)
                    // If we crossed a tile boundary, verify segment
                    if (leader.globalLevel % LEVELS_PER_TILE === 1 && leader.globalLevel > 1) {
                        this.moveVisualStep(group);
                    }

                    // Highest Zone
                    let z = Math.floor((leader.globalLevel - 1) / LEVELS_PER_ZONE);
                    if (z > this.highestReachedZone) this.highestReachedZone = z;

                    // Check for Hideout Spawn Conditions (Level 100 of NON-conquered zone)
                    // Check zone of the level we just FINISHED (globalLevel - 1)
                    let finishedLevel = leader.globalLevel - 1;
                    if (finishedLevel % LEVELS_PER_ZONE === 0) {
                        let finishedZoneIdx = (finishedLevel / LEVELS_PER_ZONE) - 1;

                        // Condition: Zone Map Must Be Complete (All 10 tiles found)
                        let isMapComplete = true;
                        let startTile = finishedZoneIdx * 10;
                        for (let t = 0; t < 10; t++) {
                            if (!this.mapPieces[startTile + t]) {
                                isMapComplete = false;
                                break;
                            }
                        }

                        // If not conquered and not active and map complete, mark ready
                        if (isMapComplete && !this.conqueredZones.includes(finishedZoneIdx) && !this.activeHideouts.has(finishedZoneIdx)) {
                            this.zonesReadyForHideout.add(finishedZoneIdx);
                        }
                    }

                } else {
                    // Just wave update
                    group.forEach(r => r.wave = leader.wave);
                }

                // Reset Barrier
                let newHP = this.calculateBarrierHealth(leader.globalLevel, leader.wave, isHideoutActive);
                group.forEach(r => r.barrierHealth = newHP);
            } else {
                group.forEach(r => r.barrierHealth = barrierHP);
            }
        }

        // Check Hideout Spawns (Area Clear)
        this.zonesReadyForHideout.forEach(zoneIdx => {
             // Check if any runner is at Level 100 of this zone
             // Level 100 of Zone 0 = Global Level 100.
             let targetGlobalLevel = (zoneIdx + 1) * LEVELS_PER_ZONE;

             let runnersAtSpot = this.runners.some(r => r.globalLevel === targetGlobalLevel);
             if (!runnersAtSpot) {
                 // Clear! Spawn Hideout
                 this.zonesReadyForHideout.delete(zoneIdx);
                 this.activeHideouts.add(zoneIdx);
                 this.log(`⚠️ Bandit Hideout detected in Zone ${zoneIdx + 1}!`);
             }
        });

        // Warp Capped Runners
        for (let i = this.runners.length - 1; i >= 0; i--) {
            let r = this.runners[i];
            if (r.zpCollected >= r.getCap() && !r.isNPC) {
                this.warpRunner(r, i);
            }
        }

        this.ensureMapSegments();
        this.updateTracker();
        this.updateGlobalZPDisplay();
        this.renderMap();
        this.renderRelics();
    }

    findNextConstructionTarget() {
        // Simple logic: Find lowest conquered zone that isn't constructed
        // Assuming Zone 0 is constructed (Road 0? No, Zone 1 is index 0)
        // We usually start with Zone 0 Road.
        // Let's sort conqueredZones
        let sorted = [...this.conqueredZones].sort((a,b) => a-b);
        for (let z of sorted) {
            if (!this.constructedRoads.includes(z)) return z;
        }
        return null;
    }

    spawnNPC(targetZone) {
        if (this.npc) return;

        let startZone = 0; // Default start at Zone 1 (Index 0)
        // Or start at end of last road?
        // Let's just start at 0 for simplicity or 'highest constructed road'.

        let id = "npc_nester";
        let name = "Nester's Crew";
        let dps = 500 * (targetZone + 1); // High DPS to move fast?
        let npc = new Runner(id, name, dps, {});
        npc.isNPC = true;
        npc.targetZone = targetZone;

        // Start position
        npc.globalLevel = 1;
        npc.currentSegmentIndex = 0;
        npc.stepInSegment = 0;

        this.npc = npc;
        this.log(`👷 Construction Crew dispatched to Zone ${targetZone + 1}`);
    }

    moveVisualStep(group) {
        group.forEach(r => {
            r.stepInSegment++;

            let currentSegment = this.mapSegments[r.currentSegmentIndex];
            // Check boundary
            if (r.stepInSegment >= currentSegment.pathCoordinates.length) {
                // Move to next segment
                r.currentSegmentIndex++;
                r.stepInSegment = 0;
            }
        });
    }

    ensureMapSegments() {
        // If any runner is on the last segment, generate next
        let allRunners = [...this.runners];
        if (this.npc) allRunners.push(this.npc);

        let maxSeg = allRunners.reduce((max, r) => Math.max(max, r.currentSegmentIndex), 0);
        if (maxSeg >= this.mapSegments.length - 1) {
            this.generateNextMapSegment();
        }
    }

    awardFragment(runner) {
        let type = RELIC_TYPES[Math.floor(Math.random() * RELIC_TYPES.length)];
        runner.fragmentsCollected[type]++;
        this.log(`${runner.name} found ${type} fragment`);

        const scoopTier = runner.relicsSnapshot["SCOOP"] || 0;
        if (Math.random() < (scoopTier * 0.025)) {
             let bonusType = RELIC_TYPES[Math.floor(Math.random() * RELIC_TYPES.length)];
             runner.fragmentsCollected[bonusType]++;
             this.log(`${runner.name} SCOOPED extra ${bonusType} fragment!`);
        }
    }

    getWavesForLevel(globalLevel) {
        if (globalLevel % 10 === 0) return 1;
        return WAVES_PER_LEVEL;
    }

    calculateBarrierHealth(globalLevel, wave, isHideoutActive = false) {
        let zone = Math.floor((globalLevel - 1) / LEVELS_PER_ZONE);
        let levelInZone = ((globalLevel - 1) % LEVELS_PER_ZONE) + 1;

        let base = DEFAULT_BARRIER_HEALTH;
        let zoneFactor = Math.pow(Math.max(1, zone + 1), 1.5);
        let levelFactor = Math.pow(Math.max(1, levelInZone), 1.2);

        let health = base * zoneFactor * levelFactor * 1.1;

        if (levelInZone === LEVELS_PER_ZONE) {
             if (isHideoutActive) {
                 health *= BANDIT_HIDEOUT_HEALTH_MULTIPLIER;
             } else {
                 health *= ZONE_BOSS_HEALTH_MULTIPLIER;
             }
        } else if (levelInZone % 10 === 0) {
             health *= BOSS_HEALTH_MULTIPLIER;
        }

        // Road Reduction
        // If road exists for this zone
        if (this.constructedRoads.includes(zone)) {
             health *= 0.1; // 90% reduction
        }

        return Math.floor(health);
    }

    warpRunner(runner, index) {
        this.globalZP += runner.zpCollected;

        for (let type in runner.fragmentsCollected) {
            this.relicFragments[type] += runner.fragmentsCollected[type];
        }

        this.runners.splice(index, 1);
        this.log(`🌀 ${runner.name} warped! +${runner.zpCollected} ZP`);

        this.updateGlobalZPDisplay();
        this.updateCostDisplay();
    }

    getRunnerCost() {
        return Math.max(10, Math.ceil(this.globalZP * 0.10));
    }

    sendRunner() {
        const cost = this.getRunnerCost();
        if (this.globalZP >= cost) {
            this.globalZP -= cost;
            this.runnersSentCount++;

            let id = Date.now() + Math.random();
            let name = "Runner " + this.runnersSentCount;
            let runner = new Runner(id, name, cost, this.relics);

            // Ensure they start at beginning
            runner.currentSegmentIndex = 0;
            runner.stepInSegment = 0;

            this.runners.push(runner);

            this.log(`🚀 ${name} sent to Zone 1`);

            this.updateGlobalZPDisplay();
            this.updateCostDisplay();
            this.save();
            return true;
        }
        return false;
    }

    upgradeRelic(type) {
        const tier = this.relics[type];
        if (tier >= 20) return;

        const cost = 10 + (tier * 10);
        if (this.relicFragments[type] >= cost) {
            this.relicFragments[type] -= cost;
            this.relics[type]++;
            this.log(`Upgraded ${type} to Tier ${this.relics[type]}`);
            this.save();
            this.renderRelics();
        }
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

    updateGlobalZPDisplay() {
        document.getElementById('global-zp').textContent = Math.floor(this.globalZP);
        let pending = this.runners.reduce((sum, r) => sum + r.zpCollected, 0);
        document.getElementById('pending-zp').textContent = pending > 0 ? `+${pending}` : "0";
    }

    updateCostDisplay() {
        document.getElementById('runner-cost').textContent = this.getRunnerCost();
    }

    calculateEstimatedCompletionTime(dps, currentHP) {
        if (dps <= 0) return "∞";
        const seconds = Math.ceil(currentHP / dps);
        if (seconds < 60) return `in ${seconds} seconds`;
        if (seconds < 3600) return `in ${Math.ceil(seconds / 60)} minutes`;
        return `in ${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
    }

    updateTracker() {
        const container = document.getElementById('tracker-list');
        container.innerHTML = '';

        let allEntities = [...this.runners];
        if (this.npc) allEntities.push(this.npc);

        const activeRunners = allEntities.length;
        if (activeRunners === 0) {
             const embed = document.createElement('div');
             embed.className = 'tracker-embed';
             embed.innerHTML = `
                <div class="tracker-embed-header">🏁 THE TRACKER 🏁</div>
                <div class="tracker-embed-description">No runners currently active.</div>
             `;
             container.appendChild(embed);
             return;
        }

        // --- Prepare Data ---
        let caravans = {};
        allEntities.forEach(r => {
            let key = `${r.globalLevel}`;
            if (!caravans[key]) caravans[key] = [];
            caravans[key].push(r);
        });

        // Convert to list for sorting
        let entities = [];

        // Process Caravans (groups > 1) and Individual Runners
        for (let key in caravans) {
            let group = caravans[key];

            // Check if NPC is leader (affects logic slightly)
            let leader = group[0];

            // Re-calc runners ahead
            let runnersAhead = allEntities.filter(r => r.globalLevel > leader.globalLevel).length;

            if (group.length > 1) {
                // It's a caravan
                let totalDPS = group.reduce((sum, r) =>
                    sum + r.getEffectiveDPS(
                        group.length,
                        runnersAhead,
                        this.highestReachedZone,
                        this.constructedRoads,
                        // Passing mapCompleted dummy here, because logic for group is complex
                        // Let's re-calculate map completion for leader
                        !!this.mapPieces[Math.floor((leader.globalLevel - 1) / LEVELS_PER_TILE)]
                    ), 0);

                entities.push({
                    type: "caravan",
                    zone: Math.floor((leader.globalLevel - 1) / LEVELS_PER_ZONE) + 1,
                    level: leader.levelInZone,
                    wave: leader.wave,
                    hp: leader.barrierHealth,
                    dps: totalDPS,
                    members: group,
                    globalLevel: leader.globalLevel
                });
            } else {
                // Single runner
                let r = group[0];
                let currentTileIdx = Math.floor((r.globalLevel - 1) / LEVELS_PER_TILE);
                let mapCompleted = !!this.mapPieces[currentTileIdx];
                let dps = r.getEffectiveDPS(1, runnersAhead, this.highestReachedZone, this.constructedRoads, mapCompleted);

                entities.push({
                    type: "runner",
                    zone: Math.floor((r.globalLevel - 1) / LEVELS_PER_ZONE) + 1,
                    level: r.levelInZone,
                    wave: r.wave,
                    hp: r.barrierHealth,
                    dps: dps,
                    runner: r,
                    globalLevel: r.globalLevel
                });
            }
        }

        // Sort: Highest Global Level First, then Wave
        entities.sort((a, b) => {
            if (a.globalLevel !== b.globalLevel) return b.globalLevel - a.globalLevel;
            return b.wave - a.wave;
        });

        // --- Build UI ---
        const embed = document.createElement('div');
        embed.className = 'tracker-embed';

        // Header
        const header = document.createElement('div');
        header.className = 'tracker-embed-header';
        header.textContent = "🏁 THE TRACKER 🏁";
        embed.appendChild(header);

        // Description
        const description = document.createElement('div');
        description.className = 'tracker-embed-description';
        description.textContent = `Furthest players on runs in the zones (Runners: ${activeRunners})`;
        embed.appendChild(description);

        // Fields
        entities.slice(0, 20).forEach(entity => {
            const field = document.createElement('div');
            field.className = 'tracker-field';

            let maxWaves = this.getWavesForLevel(entity.globalLevel);
            let estTime = this.calculateEstimatedCompletionTime(entity.dps, entity.hp);
            let hpFormatted = formatLargeNumber(Math.max(0, entity.hp));
            let dpsFormatted = formatLargeNumber(entity.dps);

            let barrierType = "";
            let zoneIndex = entity.zone - 1;
            let levelInZone = entity.level;

            // Check for Hideout Label
            if (entity.wave === maxWaves && levelInZone === LEVELS_PER_ZONE) {
                if (this.activeHideouts.has(zoneIndex)) {
                     barrierType = " | HIDEOUT";
                } else {
                     barrierType = " | ZONE BOSS";
                }
            } else if (entity.wave === maxWaves && levelInZone % 10 === 0) {
                 barrierType = " | BOSS";
            }

            if (entity.type === "caravan") {
                // Caravan Display - Just emojis on new line
                let memberEmojis = entity.members.map(m => m.getEmoji()).join(" ");

                field.innerHTML = `
                    <div class="tracker-field-name">Caravan (${entity.members.length} members)</div>
                    <div class="tracker-field-value">Z: ${entity.zone} | L: ${entity.level} | W: ${entity.wave}/${maxWaves}${barrierType} | B: ${hpFormatted} | CDPS: ${dpsFormatted} | Est: ${estTime}</div>
                    <div class="tracker-field-value">${memberEmojis}</div>
                `;
            } else {
                // Single Runner Display
                let r = entity.runner;
                let name = `${r.getEmoji()}${r.name}`;

                let extraInfo = "";
                if (r.isNPC) {
                    extraInfo = ` | Building road to Zone ${r.targetZone + 1}`;
                }

                field.innerHTML = `
                    <div class="tracker-field-name">${name}</div>
                    <div class="tracker-field-value">Z: ${entity.zone} | L: ${entity.level} | W: ${entity.wave}/${maxWaves}${barrierType} | B: ${hpFormatted} | DPS: ${dpsFormatted}${extraInfo} | Est: ${estTime}</div>
                `;
            }
            embed.appendChild(field);
        });

        container.appendChild(embed);
    }

    renderRelics() {
        const list = document.getElementById('relics-list');
        list.innerHTML = '';
        RELIC_TYPES.forEach(type => {
            const tier = this.relics[type];
            const frags = this.relicFragments[type];
            const cost = 10 + (tier * 10);
            const isMax = tier >= 20;
            const canUpgrade = !isMax && frags >= cost;

            const div = document.createElement('div');
            div.className = 'relic-item';

            let btnHtml = '';
            if (!isMax) {
                btnHtml = `<button class="small-btn ${canUpgrade ? '' : 'disabled'}"
                             onclick="game.upgradeRelic('${type}')"
                             ${canUpgrade ? '' : 'disabled'}>
                             Upgrade (${cost})
                           </button>`;
            } else {
                btnHtml = `<span class="max-badge">MAX</span>`;
            }

            div.innerHTML = `
                <div class="relic-header" style="display:flex; justify-content:space-between;">
                    <span class="relic-name">${type} (T${tier})</span>
                    <span class="relic-stats">${frags} Frags</span>
                </div>
                ${btnHtml}
            `;
            list.appendChild(div);
        });
    }

    renderMap() {
        const container = document.getElementById('map-content');
        container.innerHTML = '';

        // Find highest segment reached
        let allEntities = [...this.runners];
        if (this.npc) allEntities.push(this.npc);

        let maxSeg = 0;
        if (allEntities.length > 0) {
            maxSeg = allEntities.reduce((max, r) => Math.max(max, r.currentSegmentIndex), 0);
        }

        let visibleLimit = Math.max(maxSeg + 1, 1);

        // Calculate global tile offsets for Road Logic
        let currentGlobalTileOffset = 0;

        for (let i = 0; i < this.mapSegments.length; i++) {
            if (i > visibleLimit) break;

            let seg = this.mapSegments[i];
            let segRunners = allEntities.filter(r => r.currentSegmentIndex === seg.index);

            let exploredStep = this.maxStepPerSegment[i];
            if (exploredStep === undefined) {
                if (i < maxSeg) exploredStep = 9999;
                else exploredStep = -1;
            }

            const div = document.createElement('div');
            div.className = 'map-segment';
            // Pass constructedRoads instead of conqueredZones (as intended by render logic)
            // But wait, render logic used `conqueredZones` argument to check if road is built.
            // GameState has `this.constructedRoads`.
            div.textContent = seg.render(segRunners, this.constructedRoads, this.mapPieces, currentGlobalTileOffset, this.npc, this.activeHideouts, this.zonesReadyForHideout, exploredStep);
            container.appendChild(div);

            currentGlobalTileOffset += seg.pathCoordinates.length;
        }
    }

    save() {
        const data = {
            globalZP: this.globalZP,
            runnersSentCount: this.runnersSentCount,
            relics: this.relics,
            relicFragments: this.relicFragments,
            runners: this.runners.map(r => ({
                id: r.id, name: r.name, dps: r.dps,
                globalLevel: r.globalLevel,
                levelInZone: r.levelInZone,
                currentSegmentIndex: r.currentSegmentIndex,
                stepInSegment: r.stepInSegment,
                wave: r.wave,
                barrierHealth: r.barrierHealth,
                zpCollected: r.zpCollected,
                fragmentsCollected: r.fragmentsCollected,
                relicsSnapshot: r.relicsSnapshot
            })),
            activePatternIndex: this.activePatternIndex,
            highestReachedZone: this.highestReachedZone,
            mapPieces: this.mapPieces,
            completedMaps: this.completedMaps,
            conqueredZones: this.conqueredZones,
            constructedRoads: this.constructedRoads,
            maxStepPerSegment: this.maxStepPerSegment,
            activeHideouts: Array.from(this.activeHideouts),
            zonesReadyForHideout: Array.from(this.zonesReadyForHideout),
            npc: this.npc ? {
                id: this.npc.id, name: this.npc.name, dps: this.npc.dps,
                globalLevel: this.npc.globalLevel,
                levelInZone: this.npc.levelInZone,
                currentSegmentIndex: this.npc.currentSegmentIndex,
                stepInSegment: this.npc.stepInSegment,
                wave: this.npc.wave,
                barrierHealth: this.npc.barrierHealth,
                targetZone: this.npc.targetZone
            } : null
        };
        localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    }

    load() {
        const raw = localStorage.getItem(SAVE_KEY);
        if (raw) {
            try {
                const data = JSON.parse(raw);
                this.globalZP = data.globalZP !== undefined ? data.globalZP : 100;
                this.runnersSentCount = data.runnersSentCount || 0;
                this.relics = data.relics || this.relics;
                this.relicFragments = data.relicFragments || this.relicFragments;
                this.activePatternIndex = data.activePatternIndex || -1;

                this.highestReachedZone = data.highestReachedZone || 0;
                this.mapPieces = data.mapPieces || {};
                this.completedMaps = data.completedMaps || {};
                this.conqueredZones = data.conqueredZones || [];
                this.constructedRoads = data.constructedRoads || [];
                this.maxStepPerSegment = data.maxStepPerSegment || {};
                this.activeHideouts = new Set(data.activeHideouts || []);
                this.zonesReadyForHideout = new Set(data.zonesReadyForHideout || []);

                if (data.runners) {
                    this.runners = data.runners.map(d => {
                        let r = new Runner(d.id, d.name, d.dps, this.relics);
                        r.globalLevel = d.globalLevel || 1;
                        r.levelInZone = d.levelInZone || 1;
                        r.currentSegmentIndex = d.currentSegmentIndex || d.zone || 0;
                        r.stepInSegment = d.stepInSegment || d.step || 0;
                        r.wave = d.wave;
                        r.barrierHealth = d.barrierHealth;
                        r.zpCollected = d.zpCollected;
                        r.fragmentsCollected = d.fragmentsCollected;
                        r.relicsSnapshot = d.relicsSnapshot || {...this.relics};
                        return r;
                    });
                }

                if (data.npc) {
                    let d = data.npc;
                    let n = new Runner(d.id, d.name, d.dps, {});
                    n.isNPC = true;
                    n.targetZone = d.targetZone;
                    n.globalLevel = d.globalLevel || 1;
                    n.levelInZone = d.levelInZone || 1;
                    n.currentSegmentIndex = d.currentSegmentIndex || 0;
                    n.stepInSegment = d.stepInSegment || 0;
                    n.wave = d.wave || 1;
                    n.barrierHealth = d.barrierHealth || DEFAULT_BARRIER_HEALTH;
                    this.npc = n;
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

document.getElementById('send-runner-btn').addEventListener('click', () => {
    game.sendRunner();
});

document.getElementById('reset-save-btn').addEventListener('click', () => {
    if(confirm("Reset all progress?")) {
        game.resetSave();
    }
});

game.start();
