/**
 * migrate-csv-to-sqlite.js
 * 
 * Tool to migrate legacy CSV data into the high-performance SQLite database.
 */

const fs = require('fs');
const path = require('path');
const csv = require('csv-parser');
const config = require('./config/paths');
const db = require('./services/db.service');

// Seed file location
const SEED_CSV = path.join(__dirname, '../data/database.csv');

async function migrate() {
    console.log('--- Starting Migration: CSV -> SQLite ---');
    
    // Determine source: Use existing DB_PATH if it exists, otherwise use SEED_CSV
    let sourcePath = config.DB_PATH;
    if (!fs.existsSync(sourcePath)) {
        console.log(`Shared database not found at ${sourcePath}. Using seed file: ${SEED_CSV}`);
        sourcePath = SEED_CSV;
    }

    if (!fs.existsSync(sourcePath)) {
        console.error('ERROR: No source CSV file found (neither shared nor seed).');
        return;
    }

    console.log(`Source: ${sourcePath}`);
    console.log(`Target: ${config.SQLITE_PATH}`);

    const records = [];
    fs.createReadStream(sourcePath)
        .pipe(csv())
        .on('data', (data) => records.push(data))
        .on('end', async () => {
            console.log(`Read ${records.length} records from CSV.`);
            
            try {
                // Clear existing table for a clean migration
                db.db.exec('DELETE FROM assemblies');
                console.log('Cleared existing SQLite table.');

                // Batch insert
                await db.writeAll(records);
                console.log('Migration Complete! Database is now in SQLite.');
                process.exit(0);
            } catch (err) {
                console.error('Migration Failed:', err);
                process.exit(1);
            }
        });
}

migrate();
