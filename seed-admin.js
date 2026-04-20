/**
 * Seed script to create the first super-admin account
 *
 * Run this script once with: node seed-admin.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./src/models/Admin');
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

async function seedSuperAdmin() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lavellh');
    console.log('Connected successfully!\n');

    // Check if any super-admin already exists
    const existingSuperAdmin = await Admin.findOne({ role: 'super-admin' });

    if (existingSuperAdmin) {
      console.log('⚠️  A super-admin already exists:');
      console.log(`   Name: ${existingSuperAdmin.fullName}`);
      console.log(`   Email: ${existingSuperAdmin.email}`);
      console.log(`   Created: ${existingSuperAdmin.createdAt}\n`);

      const overwrite = await question('Do you want to create another super-admin? (yes/no): ');

      if (overwrite.toLowerCase() !== 'yes' && overwrite.toLowerCase() !== 'y') {
        console.log('\n✅ Seed cancelled. Existing super-admin remains unchanged.');
        rl.close();
        await mongoose.connection.close();
        return;
      }
    }

    console.log('\n📝 Creating Super-Admin Account\n');
    console.log('Please provide the following details:\n');

    // Get admin details from user input
    const fullName = await question('Full Name: ');
    const email = await question('Email: ');
    const password = await question('Password (min 8 characters): ');

    // Validate input
    if (!fullName || !email || !password) {
      console.log('\n❌ Error: All fields are required');
      rl.close();
      await mongoose.connection.close();
      return;
    }

    if (password.length < 8) {
      console.log('\n❌ Error: Password must be at least 8 characters');
      rl.close();
      await mongoose.connection.close();
      return;
    }

    // Check if email already exists
    const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });
    if (existingAdmin) {
      console.log('\n❌ Error: An admin with this email already exists');
      rl.close();
      await mongoose.connection.close();
      return;
    }

    // Create super-admin
    const superAdmin = new Admin({
      fullName,
      email: email.toLowerCase(),
      password,
      role: 'super-admin'
    });

    await superAdmin.save();

    console.log('\n✅ Super-Admin created successfully!\n');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║           SUPER-ADMIN ACCOUNT DETAILS                  ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  ID:         ${superAdmin._id}          ║`);
    console.log(`║  Name:       ${fullName.padEnd(40)} ║`);
    console.log(`║  Email:      ${email.padEnd(40)} ║`);
    console.log(`║  Role:       super-admin${' '.repeat(28)} ║`);
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log('║  Permissions:                                          ║');
    console.log('║  ✅ Manage Admins                                      ║');
    console.log('║  ✅ Manage Users                                       ║');
    console.log('║  ✅ Manage Providers                                   ║');
    console.log('║  ✅ View Reports                                       ║');
    console.log('║  ✅ Manage Settings                                    ║');
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('\n📌 Next Steps:');
    console.log('1. Use this account to login at: POST /api/admin/login');
    console.log('2. Create additional admin accounts if needed');
    console.log('3. Start managing your platform!\n');

    rl.close();
    await mongoose.connection.close();
    console.log('Database connection closed.');

  } catch (error) {
    console.error('\n❌ Error creating super-admin:', error.message);
    rl.close();
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the seed function
console.log('═══════════════════════════════════════════════════════════');
console.log('           LAVELLH - SUPER-ADMIN SEED SCRIPT               ');
console.log('═══════════════════════════════════════════════════════════\n');

seedSuperAdmin();
