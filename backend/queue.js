const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const queueFile = path.join(__dirname, "reels.json");
const tempFile = `${queueFile}.tmp`;

// ========================================
// LOAD REELS
// ========================================

function loadReels() {
    if (!fs.existsSync(queueFile)) {
        // Create the queue only when it genuinely does not exist.
        fs.writeFileSync(queueFile, "[]", { flag: "wx" });
    }

    let data;

    try {
        data = fs.readFileSync(queueFile, "utf8");
    } catch (error) {
        throw new Error(
            `Cannot read reels.json. Recovery stopped to protect job history: ${error.message}`
        );
    }

    try {
        const reels = JSON.parse(data);

        if (!Array.isArray(reels)) {
            throw new Error("Queue JSON must contain an array.");
        }

        return reels;
    } catch (error) {
        throw new Error(
            `reels.json is invalid. Recovery stopped to protect job history: ${error.message}`
        );
    }
}

// ========================================
// SAVE REELS ATOMICALLY
// ========================================

function saveReels(reels) {
    if (!Array.isArray(reels)) {
        throw new TypeError("saveReels expects an array.");
    }

    const json = JSON.stringify(reels, null, 2);

    // Write the complete new queue to a temporary file first.
    const fd = fs.openSync(tempFile, "w");

    try {
        fs.writeFileSync(fd, json, "utf8");
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }

    // Replace the original only after the temporary file is complete.
    // If replacement fails, the original remains available.
    fs.renameSync(tempFile, queueFile);
}

// ========================================
// UPDATE REEL
// ========================================

function updateReel(id, updates) {
    const reels = loadReels();
    const index = reels.findIndex(reel => reel.id === id);

    if (index === -1) {
        throw new Error(`Cannot update missing Reel: ${id}`);
    }

    reels[index] = {
        ...reels[index],
        ...updates,
        id: reels[index].id
    };

    saveReels(reels);

    return reels[index];
}

// ========================================
// ADD REEL
// ========================================

function addReel(url) {
    const reels = loadReels();

    const reel = {
        id: `${Date.now()}-${crypto.randomUUID()}`,
        url,
        caption: "",
        stage: "Queued",
        status: "queued",
        progress: 0,
        createdAt: new Date().toISOString()
    };

    reels.push(reel);
    saveReels(reels);

    return reel;
}

// ========================================
// GET REELS
// ========================================

function getReels() {
    return loadReels();
}

// ========================================
// EXPORTS
// ========================================

module.exports = {
    addReel,
    getReels,
    saveReels,
    updateReel
};