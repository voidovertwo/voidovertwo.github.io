// Constants
const BASE_ZP_CAP = 40;
const COST_BASE = 10;
const COST_MULTIPLIER = 1.1;
const UPDATE_INTERVAL = 1000; // 1 second
const SAVE_INTERVAL = 60000; // 60 seconds
const SAVE_KEY = "zonerunners_save_v1";
const DEFAULT_BARRIER_HEALTH = 10;
const LEVELS_PER_TILE = 50;
const LEVELS_PER_ZONE = 100;

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

        this.step = 0; // Visual Step on current MapSegment path
        this.wave = 1;

        this.barrierHealth = DEFAULT_BARRIER_HEALTH;
        this.zpCollected = 0;
        this.fragmentsCollected = {};

        RELIC_TYPES.forEach(t => this.fragmentsCollected[t] = 0);

        this.isWarping = false;
    }

    getEffectiveDPS(caravanSize, runnersAhead, highestReachedZone, mapCompleted) {
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
        let base = 0.5;
        const str = this.relicsSnapshot["STRENGTH"] || 0;
        return base + (str * 0.1);
    }

    getCap() {
        const style = this.relicsSnapshot["STYLE"] || 0;
        return BASE_ZP_CAP + (style * 4);
    }

    getEmoji() {
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

        // Each segment is roughly 40 tiles. With 1 Zone = 2 Tiles (100 levels),
        // 1 Segment = 20 Zones.
        // We need to map visual tiles to zones.

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

    render(runnersOnThisSegment = [], conqueredZones = [], maxStepExplored = -1, globalTileOffset = 0) {
        let visualGrid = this.grid.map(row => [...row]);

        let visibleSet = new Set();

        if (this.index === 0) {
            for(let oy=0; oy<=2; oy++) {
                for(let ox=6; ox<=8; ox++) {
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

        let mapPosCounts = {};
        runnersOnThisSegment.forEach(runner => {
            // runner.step is local to segment?
            // Yes, standardizing on Runner.step being index in THIS segment's path
            if (runner.step < this.pathCoordinates.length) {
                let pos = this.pathCoordinates[runner.step];
                let key = `${pos.x},${pos.y}`;
                if(!mapPosCounts[key]) mapPosCounts[key] = [];
                mapPosCounts[key].push(runner);
            }
        });

        for (let y = 0; y < visualGrid.length; y++) {
            for (let x = 0; x < visualGrid[y].length; x++) {
                let key = `${x},${y}`;

                if (!visibleSet.has(key)) {
                    visualGrid[y][x] = "☁️";
                    continue;
                }

                if (mapPosCounts[key]) {
                    visualGrid[y][x] = mapPosCounts[key][0].getEmoji();
                } else if (visualGrid[y][x] === '⬛') {
                    // Check if this specific tile belongs to a conquered zone
                    // We need to map Local Tile Index -> Global Tile Index -> Zone
                    // MapSegment needs to find index of (x,y) in pathCoordinates
                    let pathIdx = this.pathCoordinates.findIndex(p => p.x === x && p.y === y);
                    if (pathIdx !== -1) {
                        let globalTileIndex = globalTileOffset + pathIdx;
                        // 2 Tiles = 1 Zone (50 levels/tile, 100 levels/zone)
                        // Tile 0, 1 -> Zone 0
                        // Tile 2, 3 -> Zone 1
                        let zoneForTile = Math.floor(globalTileIndex / 2);

                        if (conqueredZones.includes(zoneForTile)) {
                            visualGrid[y][x] = "🛣️";
                        }
                    }
                }
            }
        }

        return visualGrid.map(row => row.join('')).join('\n');
    }
}

class GameState {
    constructor() {
        this.globalZP = 100;
        this.runnersSentCount = 0;
        this.runners = [];
        this.relics = {};
        this.relicFragments = {};

        this.mapSegments = [];
        this.activePatternIndex = -1;

        this.highestReachedZone = 0;
        this.mapPieces = {};
        this.completedMaps = {};
        this.conqueredZones = []; // Array of Zone Indices

        this.maxStepPerSegment = {}; // { segmentIndex: maxStep }

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
        let sortedRunners = [...this.runners].sort((a, b) => {
            if (a.zone !== b.zone) return b.zone - a.zone;
            return b.levelInZone - a.levelInZone; // Sub-sort by level progress
        });

        // Group by Visual Step (Segment + Step Index)
        let caravans = {};

        this.runners.forEach(r => {
            // Map segment index is NOT directly runner.zone
            // We need to calculate which map segment the runner is visually on.
            // But we simplify: Runner has `segmentIndex` and `stepIndex`.
            // Wait, previously `runner.zone` mapped to `MapSegment index`.
            // User requested 1 Tile = 50 Levels.
            // 1 Zone = 100 Levels.
            // So 1 Zone is not 1 Map Segment.
            // A Map Segment is ~40 tiles. So ~20 Zones.
            // Let's refactor: `Runner` tracks `currentSegmentIndex` and `stepInSegment`.
            // We calculate `Zone` from `globalLevel`.

            // Refactoring on the fly:
            // Runner state:
            // - globalLevel (Total levels cleared)
            // - currentSegmentIndex (Which map segment)
            // - stepInSegment (Which tile in that segment)

            // Sync derived state
            // Zone = floor(globalLevel / LEVELS_PER_ZONE)

            let key = `${r.currentSegmentIndex}_${r.stepInSegment}`;
            if (!caravans[key]) caravans[key] = [];
            caravans[key].push(r);

            // Fog of War
            if (this.maxStepPerSegment[r.currentSegmentIndex] === undefined || r.stepInSegment > this.maxStepPerSegment[r.currentSegmentIndex]) {
                this.maxStepPerSegment[r.currentSegmentIndex] = r.stepInSegment;
            }
        });

        for (let key in caravans) {
            let group = caravans[key];
            let leader = group[0];

            // Approximation for runners ahead
            let runnersAhead = sortedRunners.filter(r => r.globalLevel > leader.globalLevel).length;

            let currentZone = Math.floor(leader.globalLevel / LEVELS_PER_ZONE);

            let totalDPS = group.reduce((sum, r) =>
                sum + r.getEffectiveDPS(
                    group.length,
                    runnersAhead,
                    this.highestReachedZone,
                    this.completedMaps[currentZone]
                ), 0);

            leader.barrierHealth -= totalDPS;

            if (leader.barrierHealth <= 0) {
                // Level Complete logic (1 level per barrier break?)
                // Assuming 1 barrier = 1 level for simplicity

                // But waves? "Each tile... representing a single wave or level".
                // If 1 tile = 50 levels.
                // It means you fight 50 barriers (levels) on one tile before moving.

                leader.levelInZone++;
                leader.globalLevel++;

                // Sync group
                group.forEach(r => {
                    r.levelInZone = leader.levelInZone;
                    r.globalLevel = leader.globalLevel;

                    r.zpCollected += 1;
                    r.dps += r.getDPSGain();

                    // Steal (Every 10 levels)
                    if (r.globalLevel % 10 === 0) {
                        const stealTier = r.relicsSnapshot["STEAL"] || 0;
                        if (Math.random() < (stealTier * 0.025)) {
                             r.zpCollected += 1;
                             this.log(`${r.name} STOLE extra ZP!`);
                        }
                    }

                    // Fragment
                    if (Math.random() < 0.1) this.awardFragment(r);

                    // Map Piece (Scan)
                    let z = Math.floor(r.globalLevel / LEVELS_PER_ZONE);
                    if (!this.completedMaps[z]) {
                        const scanTier = r.relicsSnapshot["SCAN"] || 0;
                        const chance = 0.05 + (scanTier * 0.001);
                        if (Math.random() < chance) {
                            if (!this.mapPieces[z]) this.mapPieces[z] = 0;
                            this.mapPieces[z]++;
                            this.log(`${r.name} found Map Piece (Zone ${z+1})!`);
                            if (this.mapPieces[z] >= 5) {
                                this.completedMaps[z] = true;
                                this.log(`Zone ${z+1} Map Completed!`);
                            }
                        }
                    }
                });

                // Check Movement (Every 50 levels)
                // Levels 1..50 -> Step 0.
                // Level 51 -> Step 1.
                // So if (globalLevel % 50 === 1) -> Move?
                // Or if (previousLevel % 50 === 0).

                if (leader.globalLevel % LEVELS_PER_TILE === 1 && leader.globalLevel > 1) {
                    this.moveVisualStep(group);
                }

                // Zone Conquest Check (End of Zone, e.g. Level 100, 200...)
                if ((leader.globalLevel % LEVELS_PER_ZONE) === 0) {
                    let z = (leader.globalLevel / LEVELS_PER_ZONE) - 1;
                    if (!this.conqueredZones.includes(z)) {
                        this.conqueredZones.push(z);
                        this.log(`Zone ${z+1} CONQUERED! Road built.`);
                    }
                }

                // Highest Zone
                let z = Math.floor(leader.globalLevel / LEVELS_PER_ZONE);
                if (z > this.highestReachedZone) this.highestReachedZone = z;

                // Reset Barrier
                group.forEach(r => r.barrierHealth = this.calculateBarrierHealth(r.globalLevel));
            } else {
                group.forEach(r => r.barrierHealth = leader.barrierHealth);
            }
        }

        for (let i = this.runners.length - 1; i >= 0; i--) {
            let r = this.runners[i];
            if (r.zpCollected >= r.getCap()) {
                this.warpRunner(r, i);
            }
        }

        this.ensureMapSegments();

        // Removed explicit save() call from update loop
        this.updateTracker();
        this.updateGlobalZPDisplay();
        this.renderMap();
        this.renderRelics();
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
        let maxSeg = this.runners.reduce((max, r) => Math.max(max, r.currentSegmentIndex), 0);
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

    calculateBarrierHealth(globalLevel) {
        // Scale based on Zone? 10 * 1.1^Zone
        let zone = Math.floor((globalLevel - 1) / LEVELS_PER_ZONE);
        return Math.floor(10 * Math.pow(1.1, zone));
    }

    warpRunner(runner, index) {
        this.globalZP += runner.zpCollected;

        for (let type in runner.fragmentsCollected) {
            this.relicFragments[type] += runner.fragmentsCollected[type];
        }

        if (this.runnersSentCount > 0) this.runnersSentCount--;

        this.runners.splice(index, 1);
        this.log(`🌀 ${runner.name} warped! +${runner.zpCollected} ZP`);

        this.updateGlobalZPDisplay();
        this.updateCostDisplay();
    }

    getRunnerCost() {
        return Math.floor(COST_BASE * Math.pow(COST_MULTIPLIER, this.runnersSentCount));
    }

    sendRunner() {
        const cost = this.getRunnerCost();
        if (this.globalZP >= cost) {
            this.globalZP -= cost;
            this.runnersSentCount++;

            let id = Date.now() + Math.random();
            let name = "Runner " + (this.runners.length + this.runnersSentCount); // Just unique ID
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

    updateTracker() {
        const list = document.getElementById('tracker-list');
        list.innerHTML = '';

        let sorted = [...this.runners].sort((a, b) => b.globalLevel - a.globalLevel);

        sorted.forEach(r => {
            let z = Math.floor((r.globalLevel - 1) / LEVELS_PER_ZONE) + 1;
            let div = document.createElement('div');
            div.className = 'tracker-item';
            div.innerHTML = `
                <div class="tracker-header">
                    <span>${r.getEmoji()} ${r.name}</span>
                    <span>Z${z} L${r.levelInZone}</span>
                </div>
                <div class="tracker-details">
                    ZP: ${r.zpCollected}/${r.getCap()} | HP: ${Math.floor(r.barrierHealth)} | DPS: ${Math.floor(r.dps)}
                </div>
            `;
            list.appendChild(div);
        });
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
        let maxSeg = 0;
        if (this.runners.length > 0) {
            maxSeg = this.runners.reduce((max, r) => Math.max(max, r.currentSegmentIndex), 0);
        }

        let visibleLimit = Math.max(maxSeg + 1, 1);

        // Calculate global tile offsets for Road Logic
        let currentGlobalTileOffset = 0;

        for (let i = 0; i < this.mapSegments.length; i++) {
            if (i > visibleLimit) break;

            let seg = this.mapSegments[i];
            let segRunners = this.runners.filter(r => r.currentSegmentIndex === seg.index);

            let exploredStep = this.maxStepPerSegment[i];
            if (exploredStep === undefined) {
                if (i < maxSeg) exploredStep = 9999;
                else exploredStep = -1;
            }

            const div = document.createElement('div');
            div.className = 'map-segment';
            div.textContent = seg.render(segRunners, this.conqueredZones, exploredStep, currentGlobalTileOffset);
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
            maxStepPerSegment: this.maxStepPerSegment
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
                this.maxStepPerSegment = data.maxStepPerSegment || {};

                if (data.runners) {
                    this.runners = data.runners.map(d => {
                        let r = new Runner(d.id, d.name, d.dps, this.relics); // relics updated below
                        // Restore state
                        r.globalLevel = d.globalLevel || 1;
                        r.levelInZone = d.levelInZone || 1;
                        r.currentSegmentIndex = d.currentSegmentIndex || d.zone || 0; // backward compat
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

document.getElementById('send-runner-btn').addEventListener('click', () => {
    game.sendRunner();
});

document.getElementById('reset-save-btn').addEventListener('click', () => {
    if(confirm("Reset all progress?")) {
        game.resetSave();
    }
});

game.start();
