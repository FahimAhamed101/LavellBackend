require('dotenv').config();
const mongoose = require('mongoose');
const Provider = require('./src/models/Provider');

async function listProviders() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    const providers = await Provider.find().populate('userId', 'fullName email phoneNumber');

    console.log('Total Providers:', providers.length);
    console.log('\n=== PROVIDERS LIST ===\n');

    if (providers.length > 0) {
      providers.forEach((p, i) => {
        console.log(`${i + 1}. Provider ID: ${p._id}`);
        console.log(`   Name: ${p.userId?.fullName || 'N/A'}`);
        console.log(`   Email: ${p.userId?.email || 'N/A'}`);
        console.log(`   Phone: ${p.userId?.phoneNumber || 'N/A'}`);
        console.log(`   Verification Status: ${p.verificationStatus}`);
        console.log(`   Occupation: ${p.occupation || 'N/A'}`);
        console.log('');
      });
    } else {
      console.log('❌ No providers found. Register a provider first.');
    }

    await mongoose.connection.close();
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

listProviders();
