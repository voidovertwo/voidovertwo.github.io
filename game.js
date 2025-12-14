// Constants
const BASE_ZP_CAP = 40;
const COST_BASE = 10;
const COST_MULTIPLIER = 1.1;
const UPDATE_INTERVAL = 1000; // 1 second
const SAVE_KEY = "zonerunners_save_v1";
const DEFAULT_BARRIER_HEALTH = 10;

// Relic Definitions (SYNTH removed)
const RELIC_TYPES = [
    "STRENGTH", "SCOOP", "STEAL", "SIDEKICK",
    "SPEED", "STYLE", "SUPPLY", "SCAN"
];

const STYLE_EMOJIS = {
    0: "🛺", 2: "🚗", 4: "🛻", 6: "🚕", 8: "🚓",
    10: "🚙", 12: "🚑", 14: "🚐", 16: "🚚", 18: "🚌", 20: "🚛"
};

// Environments (Background Emoji Sets)
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
        this.dps = dps; // Base DPS (cost)

        // Position
        this.zone = 0; // Maps to MapSegment index
        this.level = 1; // Total steps taken
        this.step = 0; // Index in segment.pathCoordinates
        this.wave = 1;

        // Progress State
        this.barrierHealth = DEFAULT_BARRIER_HEALTH;
        this.zpCollected = 0;
        this.fragmentsCollected = {};

        RELIC_TYPES.forEach(t => this.fragmentsCollected[t] = 0);

        this.isWarping = false;
    }

    getEffectiveDPS(globalRelics, caravanSize, runnersAhead, highestReachedZone, mapCompleted) {
        let eff = this.dps;

        // SIDEKICK
        if (caravanSize > 1) {
            const sidekick = globalRelics["SIDEKICK"] || 0;
            eff *= (1 + (sidekick * 0.025));
        }

        // SUPPLY
        if (runnersAhead > 0) {
            const supply = globalRelics["SUPPLY"] || 0;
            eff *= (1 + (runnersAhead * supply * 0.005));
        }

        // SPEED (If road constructed -> Zone < Highest Reached)
        if (this.zone < highestReachedZone) {
            const speed = globalRelics["SPEED"] || 0;
            eff *= (1 + (speed * 0.025));
        }

        // Map Completion Bonus (+5 Flat)
        if (mapCompleted) {
            eff += 5;
        }

        return eff;
    }

    // DPS Gain per level (Strength)
    getDPSGain(globalRelics) {
        let base = 0.5;
        const str = globalRelics["STRENGTH"] || 0;
        return base + (str * 0.1);
    }

    getCap(globalRelics) {
        const style = globalRelics["STYLE"] || 0;
        return BASE_ZP_CAP + (style * 4);
    }

    getEmoji(globalRelics) {
        const tier = globalRelics["STYLE"] || 0;
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

    render(runnersOnThisSegment = [], globalRelics) {
        let visualGrid = this.grid.map(row => [...row]);
        let mapPosCounts = {};

        runnersOnThisSegment.forEach(runner => {
            if (runner.step < this.pathCoordinates.length) {
                let pos = this.pathCoordinates[runner.step];
                let key = `${pos.x},${pos.y}`;
                if(!mapPosCounts[key]) mapPosCounts[key] = [];
                mapPosCounts[key].push(runner);
            }
        });

        for (let key in mapPosCounts) {
            let [x, y] = key.split(',').map(Number);
            let group = mapPosCounts[key];
            visualGrid[y][x] = group[0].getEmoji(globalRelics);
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

        // Progress Tracking
        this.highestReachedZone = 0;
        this.mapPieces = {}; // { zoneIndex: count }
        this.completedMaps = {}; // { zoneIndex: bool }

        RELIC_TYPES.forEach(type => {
            this.relics[type] = 0;
            this.relicFragments[type] = 0;
        });

        this.loopId = null;
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
    }

    update() {
        // Prepare data for Supply calculation (count runners ahead)
        // Sort runners by progress descending
        let sortedRunners = [...this.runners].sort((a, b) => {
            if (a.zone !== b.zone) return b.zone - a.zone;
            return b.step - a.step;
        });

        let caravans = {};

        this.runners.forEach(r => {
            let key = `${r.zone}_${r.step}`;
            if (!caravans[key]) caravans[key] = [];
            caravans[key].push(r);

            // Update highest zone reached
            if (r.zone > this.highestReachedZone) {
                this.highestReachedZone = r.zone;
            }
        });

        for (let key in caravans) {
            let group = caravans[key];
            let leader = group[0];

            let runnersAhead = sortedRunners.filter(r =>
                (r.zone > leader.zone) || (r.zone === leader.zone && r.step > leader.step)
            ).length;

            let totalDPS = group.reduce((sum, r) =>
                sum + r.getEffectiveDPS(
                    this.relics,
                    group.length,
                    runnersAhead,
                    this.highestReachedZone,
                    this.completedMaps[r.zone]
                ), 0);

            leader.barrierHealth -= totalDPS;

            if (leader.barrierHealth <= 0) {
                let requiredWaves = Math.ceil(leader.zone + 1);
                leader.wave++;

                if (leader.wave > requiredWaves) {
                    this.moveGroup(group);
                } else {
                    group.forEach(r => {
                        r.wave = leader.wave;
                        r.barrierHealth = this.calculateBarrierHealth(r.zone);
                    });
                }
            } else {
                group.forEach(r => r.barrierHealth = leader.barrierHealth);
            }
        }

        for (let i = this.runners.length - 1; i >= 0; i--) {
            let r = this.runners[i];
            if (r.zpCollected >= r.getCap(this.relics)) {
                this.warpRunner(r, i);
            }
        }

        let maxZone = this.runners.reduce((max, r) => Math.max(max, r.zone), 0);
        if (maxZone >= this.mapSegments.length - 1) {
            this.generateNextMapSegment();
        }

        this.save();
        this.updateTracker();
        this.updateGlobalZPDisplay();
        this.renderMap();
        this.renderRelics();
    }

    moveGroup(group) {
        group.forEach(r => {
            r.zpCollected += 1;
            r.level++; // Increment total level

            if (Math.random() < 0.1) {
                this.awardFragment(r);
            }

            // STEAL (Every 10 levels)
            if (r.level % 10 === 0) {
                const stealTier = this.relics["STEAL"] || 0;
                if (Math.random() < (stealTier * 0.025)) {
                     r.zpCollected += 1;
                }
            }

            // Map Piece Chance (SCAN)
            if (!this.completedMaps[r.zone]) {
                const scanTier = this.relics["SCAN"] || 0;
                const baseChance = 0.05; // 5% base
                const chance = baseChance + (scanTier * 0.001);

                if (Math.random() < chance) {
                    if (!this.mapPieces[r.zone]) this.mapPieces[r.zone] = 0;
                    this.mapPieces[r.zone]++;

                    if (this.mapPieces[r.zone] >= 5) {
                        this.completedMaps[r.zone] = true;
                    }
                }
            }

            // Advance
            r.step++;
            r.wave = 1;

            r.dps += r.getDPSGain(this.relics);

            let currentSegment = this.mapSegments[r.zone];
            if (r.step >= currentSegment.pathCoordinates.length) {
                r.zone++;
                r.step = 0;
            }

            r.barrierHealth = this.calculateBarrierHealth(r.zone);
        });
    }

    awardFragment(runner) {
        let type = RELIC_TYPES[Math.floor(Math.random() * RELIC_TYPES.length)];
        runner.fragmentsCollected[type]++;

        const scoopTier = this.relics["SCOOP"] || 0;
        if (Math.random() < (scoopTier * 0.025)) {
             let bonusType = RELIC_TYPES[Math.floor(Math.random() * RELIC_TYPES.length)];
             runner.fragmentsCollected[bonusType]++;
        }
    }

    calculateBarrierHealth(zoneIndex) {
        return Math.floor(10 * Math.pow(1.1, zoneIndex));
    }

    warpRunner(runner, index) {
        this.globalZP += runner.zpCollected;

        for (let type in runner.fragmentsCollected) {
            this.relicFragments[type] += runner.fragmentsCollected[type];
        }

        this.runners.splice(index, 1);
        console.log(`Warped ${runner.name} with ${runner.zpCollected} ZP`);
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
            let name = "Runner " + this.runnersSentCount;
            let runner = new Runner(id, name, cost, this.relics);
            this.runners.push(runner);

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
            this.save();
            this.renderRelics();
        }
    }

    generateNextMapSegment() {
        let availablePatterns = MAP_PATTERNS.map((p, i) => i).filter(i => i !== this.activePatternIndex);
        let idx = availablePatterns[Math.floor(Math.random() * availablePatterns.length)];
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

        let sorted = [...this.runners].sort((a, b) => {
            if (a.zone !== b.zone) return b.zone - a.zone;
            return b.step - a.step;
        });

        sorted.forEach(r => {
            let div = document.createElement('div');
            div.className = 'tracker-item';
            div.innerHTML = `
                <div class="tracker-header">
                    <span>${r.getEmoji(this.relics)} ${r.name}</span>
                    <span>Z${r.zone + 1}</span>
                </div>
                <div class="tracker-details">
                    ZP: ${r.zpCollected}/${r.getCap(this.relics)} | HP: ${Math.floor(r.barrierHealth)} | DPS: ${Math.floor(r.dps)}
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

        let maxZone = 0;
        if (this.runners.length > 0) {
            maxZone = this.runners.reduce((max, r) => Math.max(max, r.zone), 0);
        }

        let visibleLimit = Math.max(maxZone + 1, 1);

        for (let i = 0; i < this.mapSegments.length; i++) {
            if (i > visibleLimit) break;

            let seg = this.mapSegments[i];
            let segRunners = this.runners.filter(r => r.zone === seg.index);
            const div = document.createElement('div');
            div.className = 'map-segment';
            div.textContent = seg.render(segRunners, this.relics);
            container.appendChild(div);
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
                zone: r.zone, level: r.level, step: r.step, wave: r.wave,
                barrierHealth: r.barrierHealth,
                zpCollected: r.zpCollected,
                fragmentsCollected: r.fragmentsCollected
            })),
            activePatternIndex: this.activePatternIndex,
            // New state
            highestReachedZone: this.highestReachedZone,
            mapPieces: this.mapPieces,
            completedMaps: this.completedMaps
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

                if (data.runners) {
                    this.runners = data.runners.map(d => {
                        let r = new Runner(d.id, d.name, d.dps, this.relics);
                        r.zone = d.zone;
                        r.level = d.level || 1; // Default for backward compat (though new feature)
                        r.step = d.step;
                        r.wave = d.wave;
                        r.barrierHealth = d.barrierHealth;
                        r.zpCollected = d.zpCollected;
                        r.fragmentsCollected = d.fragmentsCollected;
                        return r;
                    });
                }
            } catch (e) {
                console.error("Save load failed", e);
            }
        }
    }

    resetSave() {
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
