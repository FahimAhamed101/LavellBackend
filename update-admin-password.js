/**
 * Script to update admin password
 *
 * Run with: node update-admin-password.js
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

async function updateAdminPassword() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lavellh');
    console.log('Connected successfully!\n');

    // Show existing admins
    const admins = await Admin.find().select('email fullName role');

    console.log('═══════════════════════════════════════════════════════════');
    console.log('           EXISTING ADMIN ACCOUNTS                         ');
    console.log('═══════════════════════════════════════════════════════════\n');

    admins.forEach((admin, index) => {
      console.log(`${index + 1}. Email: ${admin.email}`);
      console.log(`   Name: ${admin.fullName}`);
      console.log(`   Role: ${admin.role}\n`);
    });

    // Get admin email to update
    const email = await question('Enter the email of the admin to update: ');

    const admin = await Admin.findOne({ email: email.toLowerCase() }).select('+password');

    if (!admin) {
      console.log('\n❌ Error: Admin not found with that email');
      rl.close();
      await mongoose.connection.close();
      return;
    }

    console.log(`\n✅ Found admin: ${admin.fullName} (${admin.role})\n`);

    // Get new credentials
    const updateEmail = await question('New email (press Enter to keep current): ');
    const newPassword = await question('New password (min 8 characters): ');

    // Validate password
    if (!newPassword || newPassword.length < 8) {
      console.log('\n❌ Error: Password must be at least 8 characters');
      rl.close();
      await mongoose.connection.close();
      return;
    }

    // Update email if provided
    if (updateEmail && updateEmail.trim() !== '') {
      // Check if new email already exists
      const existingEmail = await Admin.findOne({
        email: updateEmail.toLowerCase(),
        _id: { $ne: admin._id }
      });

      if (existingEmail) {
        console.log('\n❌ Error: Another admin already uses this email');
        rl.close();
        await mongoose.connection.close();
        return;
      }

      admin.email = updateEmail.toLowerCase();
    }

    // Update password
    admin.password = newPassword;
    await admin.save();

    console.log('\n✅ Admin credentials updated successfully!\n');
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║           UPDATED ADMIN CREDENTIALS                    ║');
    console.log('╠════════════════════════════════════════════════════════╣');
    console.log(`║  Name:       ${admin.fullName.padEnd(40)} ║`);
    console.log(`║  Email:      ${admin.email.padEnd(40)} ║`);
    console.log(`║  Role:       ${admin.role.padEnd(40)} ║`);
    console.log(`║  Password:   ${newPassword.padEnd(40)} ║`);
    console.log('╚════════════════════════════════════════════════════════╝');
    console.log('\n📌 You can now login with these credentials at: POST /api/admin/login\n');

    rl.close();
    await mongoose.connection.close();
    console.log('Database connection closed.');

  } catch (error) {
    console.error('\n❌ Error updating admin:', error.message);
    rl.close();
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the update function
console.log('═══════════════════════════════════════════════════════════');
console.log('        LAVELLH - UPDATE ADMIN CREDENTIALS SCRIPT          ');
console.log('═══════════════════════════════════════════════════════════\n');

updateAdminPassword();
