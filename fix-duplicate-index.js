/**
 * Migration script to fix the duplicate index issue on idCard.idNumber
 *
 * This script:
 * 1. Connects to MongoDB
 * 2. Drops the non-sparse index on idCard.idNumber
 * 3. Keeps the sparse unique index defined in the schema
 *
 * Run this script once with: node fix-duplicate-index.js
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function fixDuplicateIndex() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lavellh');
    console.log('Connected successfully!');

    // Get the Provider collection
    const db = mongoose.connection.db;
    const providersCollection = db.collection('providers');

    // List all existing indexes
    console.log('\nCurrent indexes on providers collection:');
    const indexes = await providersCollection.indexes();
    indexes.forEach((index, i) => {
      console.log(`${i + 1}. ${index.name}:`, JSON.stringify(index.key), index.sparse ? '(sparse)' : '');
    });

    // Check if ANY index exists on idCard.idNumber
    const idNumberIndexes = indexes.filter(
      idx => idx.key['idCard.idNumber'] === 1
    );

    if (idNumberIndexes.length > 0) {
      console.log(`\n⚠️  Found ${idNumberIndexes.length} index(es) on idCard.idNumber`);
      console.log('ID card verification is no longer required, so these indexes are not needed.');

      for (const idx of idNumberIndexes) {
        console.log(`\nDropping index: ${idx.name}...`);
        await providersCollection.dropIndex(idx.name);
        console.log(`✅ Successfully dropped index: ${idx.name}`);
      }
    } else {
      console.log('\n✅ No idCard.idNumber indexes found.');
    }

    // List final indexes
    console.log('\n\nFinal indexes on providers collection:');
    const finalIndexes = await providersCollection.indexes();
    finalIndexes.forEach((index, i) => {
      console.log(`${i + 1}. ${index.name}:`, JSON.stringify(index.key), index.sparse ? '(sparse)' : '');
    });

    console.log('\n✅ Migration completed successfully!');
    console.log('\nNext steps:');
    console.log('1. STOP your server if it is running (Ctrl+C)');
    console.log('2. START your server again');
    console.log('3. Try registering a provider - it should work now!');
    console.log('4. ID card images will be stored, but no verification/uniqueness checks\n');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    // Close the connection
    await mongoose.connection.close();
    console.log('Database connection closed.');
  }
}

// Run the migration
fixDuplicateIndex();
