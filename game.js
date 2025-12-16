// Constants
const BASE_ZP_CAP = 40;
const COST_BASE = 100;
const COST_MULTIPLIER = 1.1;
const UPDATE_INTERVAL = 1000; // 1 second
const SAVE_INTERVAL = 60000; // 60 seconds
const SAVE_KEY = "zonerunners_save_v2";
const DEFAULT_BARRIER_HEALTH = 10;
const WAVES_PER_LEVEL = 10;
const LEVELS_PER_TILE = 10;
const LEVELS_PER_ZONE = 100;
const BOSS_HEALTH_MULTIPLIER = 50;
const ZONE_BOSS_HEALTH_MULTIPLIER = 250;
const HIDEOUT_BOSS_MULTIPLIER = 1000; // 1000x multiplier (Total 250,000x)

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
    const tier = Math.floor(Math.log10(num) / 3);
    if (tier === 0) return Math.floor(num);
    const suffix = suffixes[tier];
    const scale = Math.pow(10, tier * 3);
    const scaled = num / scale;
    return scaled.toFixed(1) + suffix;
}

class Runner {
    constructor(id, name, dps, globalRelics, isNPC = false) {
        this.id = id;
        this.name = name;
        this.dps = dps;
        this.isNPC = isNPC;

        this.relicsSnapshot = { ...globalRelics };

        this.zone = 0;
        this.levelInZone = 1;
        this.globalLevel = 1;
        this.wave = 1;

        this.barrierHealth = DEFAULT_BARRIER_HEALTH;
        this.zpCollected = 0;
        this.fragmentsCollected = {};

        RELIC_TYPES.forEach(t => this.fragmentsCollected[t] = 0);

        this.currentSegmentIndex = 0;
        this.stepInSegment = 0;
    }

    getEffectiveDPS(caravanSize, runnersAhead, highestReachedZone, mapCompleted) {
        if (this.isNPC) return 999999999;

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

        if (this.zone < highestReachedZone) {
            const speed = relics["SPEED"] || 0;
            eff *= (1 + (speed * 0.025));
        }

        if (mapCompleted) {
            eff += 5;
        }

        return eff;
    }

    getDPSGain() {
        if (this.isNPC) return 0;
        let base = 0.5;
        const str = this.relicsSnapshot["STRENGTH"] || 0;
        return base + (str * 0.1);
    }

    getCap() {
        if (this.isNPC) return Infinity;
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
                        let npc = npcs.find(r => r.zone === zoneIndex);
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
        this.globalZP = 1000;
        this.runnersSentCount = 0;
        this.runners = [];
        this.relics = {};
        this.relicFragments = {};

        this.mapSegments = [];
        this.activePatternIndex = -1;

        this.highestReachedZone = 0;
        this.mapPieces = {};
        this.completedMaps = {};

        this.zonesReadyForHideout = new Set();
        this.activeHideouts = new Set();
        this.conqueredZones = [];

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
        this.renderRelics();
        this.updateCostDisplay();
        this.updateGlobalZPDisplay();
        this.renderMap();
        this.updateMapProgressDisplay();

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
        if (logContainer.children.length > 50) logContainer.lastChild.remove();
    }

    update() {
        let sortedRunners = [...this.runners].sort((a, b) => {
            if (a.zone !== b.zone) return b.zone - a.zone;
            return b.levelInZone - a.levelInZone;
        });

        let caravans = {};
        this.runners.forEach(r => {
            let key = `${r.globalLevel}`;
            if (!caravans[key]) caravans[key] = [];
            caravans[key].push(r);

            if (this.maxStepPerSegment[r.currentSegmentIndex] === undefined || r.stepInSegment > this.maxStepPerSegment[r.currentSegmentIndex]) {
                this.maxStepPerSegment[r.currentSegmentIndex] = r.stepInSegment;
            }
        });

        for (let key in caravans) {
            let group = caravans[key];
            let leader = group[0];

            let runnersAhead = sortedRunners.filter(r => r.globalLevel > leader.globalLevel).length;
            let currentZone = Math.floor(leader.globalLevel / LEVELS_PER_ZONE);

            let isConquered = this.conqueredZones.includes(currentZone);

            // Map Piece Collection (Per Tick)
            if (!leader.isNPC) {
                let z = Math.floor((leader.globalLevel - 1) / LEVELS_PER_ZONE);
                let pieceIdx = (leader.globalLevel - 1) % LEVELS_PER_ZONE;
                if (!this.mapPieces[z]) this.mapPieces[z] = Array(100).fill(false);

                if (!this.mapPieces[z][pieceIdx]) {
                    const scanTier = leader.relicsSnapshot["SCAN"] || 0;
                    const chance = 0.05 + (scanTier * 0.001);
                    if (Math.random() < chance) {
                         this.mapPieces[z][pieceIdx] = true;
                         // Check Full
                         if (this.mapPieces[z].every(Boolean)) {
                             if (!this.conqueredZones.includes(z) && !this.activeHideouts.has(z) && !this.zonesReadyForHideout.has(z)) {
                                 // Check if area clear (Level 100 occupied)
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
                    }
                }
            }

            let zonePieces = this.mapPieces[currentZone] || [];
            let isMapped = zonePieces.length === 100 && zonePieces.every(Boolean);

            let totalDPS = group.reduce((sum, r) =>
                sum + r.getEffectiveDPS(
                    group.length,
                    runnersAhead,
                    this.highestReachedZone,
                    isMapped
                ), 0);

            leader.barrierHealth -= totalDPS;

            if (leader.barrierHealth <= 0) {
                // Wave Complete
                leader.wave++;

                let maxWaves = this.getWavesForLevel(leader.globalLevel, isConquered);

                if (leader.wave > maxWaves) {
                    // Level Complete

                    // Check Hideout Victory
                    let z = Math.floor((leader.globalLevel - 1) / LEVELS_PER_ZONE);
                    let levelInZ = ((leader.globalLevel - 1) % LEVELS_PER_ZONE) + 1;

                    if (this.activeHideouts.has(z) && levelInZ === 100) {
                        this.activeHideouts.delete(z);
                        this.log(`⚔️ Hideout in Zone ${z+1} CLEARED! Construction Team Dispatched.`);
                        this.spawnNPC(z);
                    }

                    leader.levelInZone++;
                    leader.globalLevel++;
                    leader.wave = 1;

                    group.forEach(r => {
                        r.levelInZone = leader.levelInZone;
                        r.globalLevel = leader.globalLevel;
                        r.wave = 1;

                        if (!r.isNPC) {
                            let zpGain = 0;
                            let completedLevel = leader.globalLevel - 1;
                            if (completedLevel % 10 === 0) zpGain += 1;
                            if (completedLevel % 100 === 0) zpGain += 10;

                            let onRoad = this.conqueredZones.includes(Math.floor((r.globalLevel - 1) / LEVELS_PER_ZONE));
                            if (r.zpCollected < r.getCap() || onRoad) {
                                r.zpCollected += zpGain;
                            }

                            r.dps += r.getDPSGain();

                            if (r.globalLevel % 10 === 0) {
                                const stealTier = r.relicsSnapshot["STEAL"] || 0;
                                if (Math.random() < (stealTier * 0.025)) {
                                     r.zpCollected += 1;
                                }
                            }

                            if (Math.random() < 0.1) this.awardFragment(r);
                        }
                    });

                    if (leader.globalLevel % LEVELS_PER_TILE === 1 && leader.globalLevel > 1) {
                        this.moveVisualStep(group);
                    }

                    if (leader.isNPC && (leader.globalLevel - 1) % LEVELS_PER_ZONE === 0) {
                        let finishedZone = Math.floor((leader.globalLevel - 2) / LEVELS_PER_ZONE);
                        if (!this.conqueredZones.includes(finishedZone)) {
                            this.conqueredZones.push(finishedZone);
                            this.log(`🏗️ Road Construction Complete for Zone ${finishedZone+1}!`);
                            this.runners = this.runners.filter(r => r !== leader);
                        }
                    }

                    let zNew = Math.floor((leader.globalLevel - 1) / LEVELS_PER_ZONE);
                    if (zNew > this.highestReachedZone) this.highestReachedZone = zNew;

                } else {
                    group.forEach(r => r.wave = leader.wave);
                }

                let newHP = this.calculateBarrierHealth(leader.globalLevel, leader.wave, isConquered);
                group.forEach(r => r.barrierHealth = newHP);
            } else {
                group.forEach(r => r.barrierHealth = leader.barrierHealth);
            }
        }

        this.zonesReadyForHideout.forEach(z => {
             let bossLevel = (z + 1) * LEVELS_PER_ZONE;
             let busy = this.runners.some(r => !r.isNPC && r.globalLevel === bossLevel);
             if (!busy) {
                 this.zonesReadyForHideout.delete(z);
                 this.activeHideouts.add(z);
                 this.log(`🏰 Area clear! Bandit Hideout Spawned in Zone ${z+1}!`);
             }
        });

        for (let i = this.runners.length - 1; i >= 0; i--) {
            let r = this.runners[i];
            let onRoad = this.conqueredZones.includes(Math.floor((r.globalLevel - 1) / LEVELS_PER_ZONE));
            if (!r.isNPC && r.zpCollected >= r.getCap() && !onRoad) {
                this.warpRunner(r, i);
            }
        }

        this.ensureMapSegments();
        this.updateTracker();
        this.updateGlobalZPDisplay();
        this.renderMap();
        this.updateMapProgressDisplay();
        this.renderRelics();
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

    awardFragment(runner) {
        let type = RELIC_TYPES[Math.floor(Math.random() * RELIC_TYPES.length)];
        runner.fragmentsCollected[type]++;
        this.log(`${runner.name} found ${type} fragment`);
    }

    getWavesForLevel(globalLevel, isConquered) {
        if (isConquered && (globalLevel % 10 !== 0)) return 1;
        if (globalLevel % 10 === 0) return 1;
        return WAVES_PER_LEVEL;
    }

    calculateBarrierHealth(globalLevel, wave, isConquered) {
        let zone = Math.floor((globalLevel - 1) / LEVELS_PER_ZONE);
        let levelInZone = ((globalLevel - 1) % LEVELS_PER_ZONE) + 1;
        let base = DEFAULT_BARRIER_HEALTH;
        let zoneFactor = Math.pow(Math.max(1, zone + 1), 1.5);
        let levelFactor = Math.pow(Math.max(1, levelInZone), 1.2);
        let health = base * zoneFactor * levelFactor * 1.1;

        if (levelInZone === LEVELS_PER_ZONE) {
             health *= ZONE_BOSS_HEALTH_MULTIPLIER;
             if (this.activeHideouts.has(zone)) {
                 health *= HIDEOUT_BOSS_MULTIPLIER;
             }
        } else if (levelInZone % 10 === 0) {
             health *= BOSS_HEALTH_MULTIPLIER;
        }

        if (isConquered) {
            health *= 0.10;
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

    spawnNPC(zoneIndex) {
        let id = Date.now() + Math.random();
        let name = "Construction Team";
        let runner = new Runner(id, name, 0, this.relics, true);

        runner.globalLevel = (zoneIndex * LEVELS_PER_ZONE) + 1;
        runner.zone = zoneIndex;
        runner.levelInZone = 1;

        let targetGlobalTile = zoneIndex * 10;

        let currentTileCount = 0;
        for(let i=0; i<this.mapSegments.length; i++) {
            let seg = this.mapSegments[i];
            let len = seg.pathCoordinates.length;
            if (targetGlobalTile < currentTileCount + len) {
                runner.currentSegmentIndex = i;
                runner.stepInSegment = targetGlobalTile - currentTileCount;
                break;
            }
            currentTileCount += len;
        }

        this.runners.push(runner);
        this.log(`🚧 NPC Team deployed to Zone ${zoneIndex+1}`);
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

    updateTracker() {
        const container = document.getElementById('tracker-list');
        container.innerHTML = '';
        const activeRunners = this.runners.length;
        if (activeRunners === 0) {
             const embed = document.createElement('div');
             embed.className = 'tracker-embed';
             embed.innerHTML = `<div class="tracker-embed-header">🏁 THE TRACKER 🏁</div><div class="tracker-embed-description">No runners currently active.</div>`;
             container.appendChild(embed);
             return;
        }

        let caravans = {};
        this.runners.forEach(r => {
            let key = `${r.globalLevel}`;
            if (!caravans[key]) caravans[key] = [];
            caravans[key].push(r);
        });

        let entities = [];
        for (let key in caravans) {
            let group = caravans[key];
            let leader = group[0];
            let runnersAhead = this.runners.filter(r => r.globalLevel > leader.globalLevel).length;
            let currentZone = Math.floor(leader.globalLevel / LEVELS_PER_ZONE);

            let zonePieces = this.mapPieces[currentZone] || [];
            let isMapped = zonePieces.length === 100 && zonePieces.every(Boolean);

            let totalDPS = group.reduce((sum, r) => sum + r.getEffectiveDPS(group.length, runnersAhead, this.highestReachedZone, isMapped), 0);

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
        description.textContent = `Furthest players on runs in the zones (Runners: ${activeRunners})`;
        embed.appendChild(description);

        entities.slice(0, 20).forEach(entity => {
            const field = document.createElement('div');
            field.className = 'tracker-field';
            let maxWaves = this.getWavesForLevel(entity.globalLevel, this.conqueredZones.includes(entity.zone - 1));
            let estTime = this.calculateEstimatedCompletionTime(entity.dps, entity.hp);
            let hpFormatted = formatLargeNumber(Math.max(0, entity.hp));
            let dpsFormatted = formatLargeNumber(entity.dps);
            let barrierType = "";
            if (entity.wave === maxWaves) {
                if (entity.level === LEVELS_PER_ZONE) barrierType = " | ZONE BOSS";
                else if (entity.level % 10 === 0) barrierType = " | BOSS";
            }

            if (entity.type === "caravan") {
                let memberEmojis = entity.members.map(m => m.getEmoji()).join(" ");
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
        container.innerHTML = '';
        let maxZone = Math.max(...Object.keys(this.mapPieces).map(k=>parseInt(k)), this.highestReachedZone, 0);
        for (let z = maxZone; z >= 0; z--) {
            let pieces = this.mapPieces[z] || Array(100).fill(false);
            let total = pieces.filter(Boolean).length;

            if (total === 0 && z < maxZone) {
                // keep context
            }

            let div = document.createElement('div');
            div.className = 'map-progress-zone';
            let status = "Mapping...";
            if (total >= 100) status = "Mapped!";
            if (this.conqueredZones.includes(z)) status = "CONQUERED";
            let html = `<div class="map-progress-header">Zone ${z+1} - ${status}</div><div class="map-progress-grid">`;
            for(let t=0; t<10; t++) {
                 let start = t * 10;
                 let end = start + 10;
                 let p = pieces.slice(start, end).filter(Boolean).length;

                 let color = "#555";
                 if(p > 0) color = "orange";
                 if(p == 10) color = "#8B4513";
                 if(this.conqueredZones.includes(z)) color = "#4CAF50";

                 html += `<div style="color:${color}">S${t+1}: ${p}/10</div>`;
            }
            html += `</div>`;
            div.innerHTML = html;
            container.appendChild(div);
        }
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
            let btnHtml = isMax ? `<span class="max-badge">MAX</span>` : `<button class="small-btn ${canUpgrade ? '' : 'disabled'}" onclick="game.upgradeRelic('${type}')" ${canUpgrade ? '' : 'disabled'}>Upgrade (${cost})</button>`;
            div.innerHTML = `<div class="relic-header" style="display:flex; justify-content:space-between;"><span class="relic-name">${type} (T${tier})</span><span class="relic-stats">${frags} Frags</span></div>${btnHtml}`;
            list.appendChild(div);
        });
    }

    renderMap() {
        const container = document.getElementById('map-content');
        container.innerHTML = '';
        let maxSeg = 0;
        if (this.runners.length > 0) {
            maxSeg = this.runners.reduce((max, r) => Math.max(max, r.currentSegmentIndex), 0);
        }
        let visibleLimit = Math.max(maxSeg + 1, 1);
        let currentGlobalTileOffset = 0;

        let npcs = this.runners.filter(r => r.isNPC);

        for (let i = 0; i < this.mapSegments.length; i++) {
            if (i > visibleLimit) break;
            let seg = this.mapSegments[i];
            let segRunners = this.runners.filter(r => r.currentSegmentIndex === seg.index);
            let exploredStep = this.maxStepPerSegment[i] !== undefined ? this.maxStepPerSegment[i] : (i < maxSeg ? 9999 : -1);

            const div = document.createElement('div');
            div.className = 'map-segment';
            div.innerHTML = seg.render(segRunners, this.conqueredZones, exploredStep, currentGlobalTileOffset, this.mapPieces, this.activeHideouts, npcs);
            container.appendChild(div);
            currentGlobalTileOffset += seg.pathCoordinates.length;
        }
    }

    calculateEstimatedCompletionTime(dps, currentHP) {
        if (dps <= 0) return "∞";
        const seconds = Math.ceil(currentHP / dps);
        if (seconds < 60) return `in ${seconds}s`;
        if (seconds < 3600) return `in ${Math.ceil(seconds / 60)}m`;
        return `in ${Math.floor(seconds / 3600)}h ${Math.ceil((seconds % 3600) / 60)}m`;
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
                relicsSnapshot: r.relicsSnapshot,
                isNPC: r.isNPC
            })),
            activePatternIndex: this.activePatternIndex,
            highestReachedZone: this.highestReachedZone,
            mapPieces: this.mapPieces,
            completedMaps: this.completedMaps,
            conqueredZones: this.conqueredZones,
            maxStepPerSegment: this.maxStepPerSegment,
            zonesReadyForHideout: Array.from(this.zonesReadyForHideout),
            activeHideouts: Array.from(this.activeHideouts)
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

                // Migration
                for(let k in this.mapPieces) {
                    if (Array.isArray(this.mapPieces[k])) {
                        if (this.mapPieces[k].length === 10) {
                             // Convert [10, 10...] counts to [true, true...] (100)
                             let old = this.mapPieces[k];
                             let newArr = Array(100).fill(false);
                             for(let t=0; t<10; t++) {
                                 let count = old[t];
                                 if(typeof count === 'number') {
                                     for(let c=0; c<count && c<10; c++) {
                                         newArr[t*10 + c] = true;
                                     }
                                 } else if (count === true) {
                                     // full
                                     for(let c=0; c<10; c++) newArr[t*10 + c] = true;
                                 }
                             }
                             this.mapPieces[k] = newArr;
                        }
                    } else if (this.mapPieces[k] === true) {
                         this.mapPieces[k] = Array(100).fill(true);
                    } else {
                         this.mapPieces[k] = Array(100).fill(false);
                    }
                }

                this.completedMaps = data.completedMaps || {};
                this.conqueredZones = data.conqueredZones || [];
                this.maxStepPerSegment = data.maxStepPerSegment || {};

                if (data.zonesReadyForHideout) this.zonesReadyForHideout = new Set(data.zonesReadyForHideout);
                if (data.activeHideouts) this.activeHideouts = new Set(data.activeHideouts);

                if (data.runners) {
                    this.runners = data.runners.map(d => {
                        let r = new Runner(d.id, d.name, d.dps, this.relics, d.isNPC || false);
                        r.globalLevel = d.globalLevel || 1;
                        r.levelInZone = d.levelInZone || 1;
                        r.currentSegmentIndex = d.currentSegmentIndex !== undefined ? d.currentSegmentIndex : (d.zone || 0);
                        r.stepInSegment = d.stepInSegment || d.step || 0;
                        r.wave = d.wave;
                        r.barrierHealth = d.barrierHealth;
                        r.zpCollected = d.zpCollected;
                        r.fragmentsCollected = d.fragmentsCollected;
                        r.relicsSnapshot = d.relicsSnapshot || {...this.relics};
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
document.getElementById('send-runner-btn').addEventListener('click', () => { game.sendRunner(); });
document.getElementById('reset-save-btn').addEventListener('click', () => { if(confirm("Reset all progress?")) { game.resetSave(); }});
game.start();
