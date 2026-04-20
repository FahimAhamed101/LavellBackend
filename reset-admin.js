/**
 * Script to reset super admin credentials
 *
 * INSTRUCTIONS:
 * 1. Edit the NEW_EMAIL and NEW_PASSWORD below
 * 2. Run with: node reset-admin.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./src/models/Admin');

// ============================================
// EDIT THESE VALUES WITH YOUR NEW CREDENTIALS
// ============================================
const CURRENT_EMAIL = 'rokey02@gmail.com'; // Current super admin email
const NEW_EMAIL = 'admin@lavellh.com';     // New email (or keep the same)
const NEW_PASSWORD = 'admin123456';        // New password (min 8 characters)
// ============================================

async function resetAdmin() {
  try {
    console.log('═══════════════════════════════════════════════════════════');
    console.log('        LAVELLH - RESET ADMIN CREDENTIALS                  ');
    console.log('═══════════════════════════════════════════════════════════\n');

    // Connect to MongoDB
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lavellh');
    console.log('✅ Connected successfully!\n');

    // Validate inputs
    if (!NEW_PASSWORD || NEW_PASSWORD.length < 8) {
      console.log('❌ Error: Password must be at least 8 characters');
      await mongoose.connection.close();
      process.exit(1);
    }

    // Find the admin
    console.log(`🔍 Looking for admin: ${CURRENT_EMAIL}...`);
    const admin = await Admin.findOne({ email: CURRENT_EMAIL.toLowerCase() }).select('+password');

    if (!admin) {
      console.log(`❌ Error: Admin not found with email: ${CURRENT_EMAIL}`);
      await mongoose.connection.close();
      process.exit(1);
    }

    console.log(`✅ Found admin: ${admin.fullName} (${admin.role})\n`);

    // Check if new email is different and already exists
    if (NEW_EMAIL.toLowerCase() !== CURRENT_EMAIL.toLowerCase()) {
      const existingEmail = await Admin.findOne({
        email: NEW_EMAIL.toLowerCase(),
        _id: { $ne: admin._id }
      });

      if (existingEmail) {
        console.log('❌ Error: Another admin already uses this email');
        await mongoose.connection.close();
        process.exit(1);
      }
    }

    // Update credentials
    console.log('🔄 Updating credentials...');
    admin.email = NEW_EMAIL.toLowerCase();
    admin.password = NEW_PASSWORD;
    await admin.save();

    console.log('✅ Admin credentials updated successfully!\n');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║           UPDATED ADMIN CREDENTIALS                    ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Name:       ${admin.fullName.padEnd(40)} ║`);
    console.log(`║  Email:      ${admin.email.padEnd(40)} ║`);
    console.log(`║  Role:       ${admin.role.padEnd(40)} ║`);
    console.log(`║  Password:   ${NEW_PASSWORD.padEnd(40)} ║`);
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('\n📌 Login Endpoint: POST /api/admin/login');
    console.log('\n📝 Request Body:');
    console.log(JSON.stringify({
      email: admin.email,
      password: NEW_PASSWORD
    }, null, 2));
    console.log('');

    await mongoose.connection.close();
    console.log('🔌 Database connection closed.');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Error resetting admin:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the reset function
resetAdmin();
