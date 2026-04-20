const mongoose = require('mongoose');
require('dotenv').config();

const Provider = require('./src/models/Provider');
const Category = require('./src/models/Category');

async function assignCategory() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Get Elizabeth Olson's provider
    const provider = await Provider.findOne({})
      .populate('userId', 'fullName email')
      .sort({ createdAt: -1 }); // Get the latest provider

    if (!provider) {
      console.log('No provider found');
      return;
    }

    console.log('Provider found:');
    console.log('  Name:', provider.userId?.fullName);
    console.log('  Email:', provider.userId?.email);
    console.log('  Provider ID:', provider._id);
    console.log('  Current Categories:', provider.categories?.length || 0);
    console.log('');

    // Get available categories
    console.log('Available Categories:');
    const categories = await Category.find({ isActive: true });
    categories.forEach((cat, index) => {
      console.log(`  ${index + 1}. ${cat.name} (ID: ${cat._id})`);
    });
    console.log('');

    // Assign the Beauty category (or whichever you created)
    const beautyCategory = await Category.findOne({ name: /beauty/i });

    if (!beautyCategory) {
      console.log('Beauty category not found. Using first available category...');
      if (categories.length === 0) {
        console.log('No categories available!');
        return;
      }
    }

    const categoryToAssign = beautyCategory || categories[0];

    console.log(`Assigning category: ${categoryToAssign.name}`);

    // Add category to provider if not already assigned
    if (!provider.categories.includes(categoryToAssign._id)) {
      provider.categories.push(categoryToAssign._id);
      await provider.save();
      console.log('✓ Category assigned successfully!');
    } else {
      console.log('Category already assigned');
    }

    // Verify
    const updatedProvider = await Provider.findById(provider._id).populate('categories', 'name');
    console.log('\nUpdated provider categories:');
    updatedProvider.categories.forEach(cat => {
      console.log(`  - ${cat.name}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed');
  }
}

assignCategory();
