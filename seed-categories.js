/**
 * Seed script to create initial categories
 *
 * Run this script with: node seed-categories.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Category = require('./src/models/Category');
const Admin = require('./src/models/Admin');

const sampleCategories = [
  // Parent Categories
  {
    name: 'Home Services',
    description: 'Professional home repair and maintenance services',
    icon: '🏠',
    displayOrder: 1,
    isActive: true,
    subcategories: [
      {
        name: 'Plumbing',
        description: 'Professional plumbing services - repairs, installations, and maintenance',
        icon: '🔧',
        displayOrder: 1
      },
      {
        name: 'Electrical',
        description: 'Licensed electricians for all your electrical needs',
        icon: '⚡',
        displayOrder: 2
      },
      {
        name: 'HVAC',
        description: 'Heating, ventilation, and air conditioning services',
        icon: '❄️',
        displayOrder: 3
      },
      {
        name: 'Carpentry',
        description: 'Professional carpentry and woodworking services',
        icon: '🪚',
        displayOrder: 4
      }
    ]
  },
  {
    name: 'Cleaning Services',
    description: 'Professional cleaning services for homes and offices',
    icon: '🧹',
    displayOrder: 2,
    isActive: true,
    subcategories: [
      {
        name: 'House Cleaning',
        description: 'Residential cleaning services',
        icon: '🏡',
        displayOrder: 1
      },
      {
        name: 'Office Cleaning',
        description: 'Commercial and office cleaning services',
        icon: '🏢',
        displayOrder: 2
      },
      {
        name: 'Deep Cleaning',
        description: 'Thorough deep cleaning services',
        icon: '✨',
        displayOrder: 3
      }
    ]
  },
  {
    name: 'Beauty & Wellness',
    description: 'Beauty and wellness services',
    icon: '💆',
    displayOrder: 3,
    isActive: true,
    subcategories: [
      {
        name: 'Hair Salon',
        description: 'Professional hair styling and treatment',
        icon: '💇',
        displayOrder: 1
      },
      {
        name: 'Massage',
        description: 'Therapeutic massage services',
        icon: '💆',
        displayOrder: 2
      },
      {
        name: 'Spa',
        description: 'Full spa and wellness treatments',
        icon: '🧖',
        displayOrder: 3
      }
    ]
  },
  {
    name: 'Moving & Delivery',
    description: 'Moving, delivery, and transportation services',
    icon: '🚚',
    displayOrder: 4,
    isActive: true,
    subcategories: [
      {
        name: 'House Moving',
        description: 'Professional moving services',
        icon: '📦',
        displayOrder: 1
      },
      {
        name: 'Delivery',
        description: 'Local delivery services',
        icon: '🚛',
        displayOrder: 2
      }
    ]
  },
  {
    name: 'Professional Services',
    description: 'Professional business and consulting services',
    icon: '💼',
    displayOrder: 5,
    isActive: true,
    subcategories: [
      {
        name: 'Legal Services',
        description: 'Legal consultation and services',
        icon: '⚖️',
        displayOrder: 1
      },
      {
        name: 'Accounting',
        description: 'Accounting and bookkeeping services',
        icon: '📊',
        displayOrder: 2
      },
      {
        name: 'IT Services',
        description: 'IT support and consulting',
        icon: '💻',
        displayOrder: 3
      }
    ]
  }
];

async function seedCategories() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lavellh');
    console.log('Connected successfully!\n');

    // Find a super-admin to use as createdBy
    const superAdmin = await Admin.findOne({ role: 'super-admin' });

    if (!superAdmin) {
      console.log('❌ Error: No super-admin found. Please run seed-admin.js first.');
      await mongoose.connection.close();
      return;
    }

    console.log(`Using super-admin: ${superAdmin.fullName} (${superAdmin.email})\n`);

    // Check if categories already exist
    const existingCategories = await Category.countDocuments();

    if (existingCategories > 0) {
      console.log(`⚠️  Warning: ${existingCategories} category(ies) already exist.`);
      console.log('This script will add new categories without removing existing ones.\n');
    }

    let createdCount = 0;
    let skippedCount = 0;

    // Create categories
    for (const categoryData of sampleCategories) {
      // Check if parent category already exists
      const existingParent = await Category.findOne({
        name: { $regex: new RegExp(`^${categoryData.name}$`, 'i') }
      });

      let parentCategory;

      if (existingParent) {
        console.log(`⏭️  Parent category "${categoryData.name}" already exists. Skipping...`);
        parentCategory = existingParent;
        skippedCount++;
      } else {
        // Create parent category
        parentCategory = new Category({
          name: categoryData.name,
          description: categoryData.description,
          icon: categoryData.icon,
          displayOrder: categoryData.displayOrder,
          isActive: categoryData.isActive,
          createdBy: superAdmin._id
        });

        await parentCategory.save();
        console.log(`✅ Created parent category: ${categoryData.name}`);
        createdCount++;
      }

      // Create subcategories if they exist
      if (categoryData.subcategories && categoryData.subcategories.length > 0) {
        for (const subData of categoryData.subcategories) {
          // Check if subcategory already exists
          const existingSub = await Category.findOne({
            name: { $regex: new RegExp(`^${subData.name}$`, 'i') }
          });

          if (existingSub) {
            console.log(`   ⏭️  Subcategory "${subData.name}" already exists. Skipping...`);
            skippedCount++;
          } else {
            const subcategory = new Category({
              name: subData.name,
              description: subData.description,
              icon: subData.icon,
              parentCategory: parentCategory._id,
              displayOrder: subData.displayOrder,
              isActive: true,
              createdBy: superAdmin._id
            });

            await subcategory.save();
            console.log(`   ✅ Created subcategory: ${subData.name}`);
            createdCount++;
          }
        }
      }

      console.log('');
    }

    // Get final count
    const totalCategories = await Category.countDocuments();
    const parentCount = await Category.countDocuments({ parentCategory: null });
    const subCount = await Category.countDocuments({ parentCategory: { $ne: null } });

    console.log('═══════════════════════════════════════════════════════');
    console.log('                  SEED SUMMARY                         ');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`✅ Categories created: ${createdCount}`);
    console.log(`⏭️  Categories skipped: ${skippedCount}`);
    console.log(`📊 Total categories in database: ${totalCategories}`);
    console.log(`   - Parent categories: ${parentCount}`);
    console.log(`   - Subcategories: ${subCount}`);
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('📌 Next Steps:');
    console.log('1. View categories at: GET /api/categories');
    console.log('2. Manage categories at: GET /api/admin/categories');
    console.log('3. Check the CATEGORY_API_GUIDE.md for full API documentation\n');

    await mongoose.connection.close();
    console.log('Database connection closed.');

  } catch (error) {
    console.error('\n❌ Error seeding categories:', error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the seed function
console.log('═══════════════════════════════════════════════════════');
console.log('          LAVELLH - CATEGORY SEED SCRIPT               ');
console.log('═══════════════════════════════════════════════════════\n');

seedCategories();
