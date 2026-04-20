/**
 * Seed script to create sample services
 *
 * Prerequisites:
 * 1. Run seed-admin.js first
 * 2. Run seed-categories.js
 * 3. Have at least one approved provider
 *
 * Run this script with: node seed-services.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Service = require('./src/models/Service');
const Provider = require('./src/models/Provider');
const Category = require('./src/models/Category');

async function seedServices() {
  try {
    // Connect to MongoDB
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/lavellh');
    console.log('Connected successfully!\n');

    // Get first approved provider
    const provider = await Provider.findOne({ verificationStatus: 'approved' });

    if (!provider) {
      console.log('❌ Error: No approved provider found.');
      console.log('Please ensure you have at least one approved provider before seeding services.');
      await mongoose.connection.close();
      return;
    }

    console.log(`Using provider ID: ${provider._id}\n`);

    // Get categories
    const homeServices = await Category.findOne({ name: /home services/i });
    const cleaningServices = await Category.findOne({ name: /cleaning/i });
    const beautyWellness = await Category.findOne({ name: /beauty/i });

    if (!homeServices && !cleaningServices && !beautyWellness) {
      console.log('❌ Error: No categories found.');
      console.log('Please run seed-categories.js first.');
      await mongoose.connection.close();
      return;
    }

    // Sample services
    const sampleServices = [];

    // Service 1: Plumbing (No appointment)
    if (homeServices) {
      sampleServices.push({
        providerId: provider._id,
        servicePhoto: 'https://images.unsplash.com/photo-1607472586893-edb57bdc0e39',
        category: homeServices._id,
        headline: 'Professional Plumbing Services',
        description: 'Expert plumbing services for all your home needs. From leaky faucets to complete installations, we handle it all with precision and care. Licensed and insured professionals ready to help.',
        whyChooseUs: {
          twentyFourSeven: 'Available 24/7 for emergency plumbing repairs and installations',
          efficientAndFast: 'Quick response time with efficient problem-solving techniques',
          affordablePrices: 'Competitive pricing with transparent quotes and no hidden fees',
          expertTeam: 'Licensed plumbers with 10+ years of experience in residential plumbing'
        },
        basePrice: 150,
        appointmentEnabled: false,
        isActive: true
      });
    }

    // Service 2: House Cleaning (With appointments)
    if (cleaningServices) {
      sampleServices.push({
        providerId: provider._id,
        servicePhoto: 'https://images.unsplash.com/photo-1581578731548-c64695cc6952',
        category: cleaningServices._id,
        headline: 'Deep House Cleaning Service',
        description: 'Transform your home with our professional deep cleaning service. We clean every corner, from baseboards to ceiling fans, ensuring a spotless and healthy living environment. Eco-friendly products available.',
        whyChooseUs: {
          twentyFourSeven: 'Flexible scheduling including evenings and weekends',
          efficientAndFast: 'Trained team completes thorough cleaning in minimal time',
          affordablePrices: 'Affordable packages with discounts for recurring services',
          expertTeam: 'Background-checked cleaners with specialized training'
        },
        basePrice: 0,
        appointmentEnabled: true,
        appointmentSlots: [
          {
            duration: 30,
            durationUnit: 'minutes',
            price: 50
          },
          {
            duration: 1,
            durationUnit: 'hours',
            price: 90
          },
          {
            duration: 2,
            durationUnit: 'hours',
            price: 150
          }
        ],
        isActive: true
      });
    }

    // Service 3: Massage Therapy (With appointments)
    if (beautyWellness) {
      sampleServices.push({
        providerId: provider._id,
        servicePhoto: 'https://images.unsplash.com/photo-1544161515-4ab6ce6db874',
        category: beautyWellness._id,
        headline: 'Relaxing Therapeutic Massage',
        description: 'Experience ultimate relaxation with our therapeutic massage services. Our certified massage therapists use proven techniques to relieve stress, reduce muscle tension, and promote overall wellness.',
        whyChooseUs: {
          twentyFourSeven: 'Early morning and late evening appointments available',
          efficientAndFast: 'Immediate relief from muscle tension and stress',
          affordablePrices: 'Competitive rates with package deals available',
          expertTeam: 'Certified massage therapists with 5+ years experience'
        },
        basePrice: 0,
        appointmentEnabled: true,
        appointmentSlots: [
          {
            duration: 30,
            durationUnit: 'minutes',
            price: 45
          },
          {
            duration: 60,
            durationUnit: 'minutes',
            price: 80
          },
          {
            duration: 90,
            durationUnit: 'minutes',
            price: 110
          }
        ],
        isActive: true
      });
    }

    // Service 4: HVAC Maintenance (No appointment)
    if (homeServices) {
      sampleServices.push({
        providerId: provider._id,
        servicePhoto: 'https://images.unsplash.com/photo-1581244277943-fe4a9c777189',
        category: homeServices._id,
        headline: 'HVAC Installation & Repair',
        description: 'Complete heating and cooling solutions for your home or business. From installation to maintenance and emergency repairs, our certified technicians ensure your comfort year-round.',
        whyChooseUs: {
          twentyFourSeven: 'Emergency repair services available 24/7 all year',
          efficientAndFast: 'Same-day service for most repairs and installations',
          affordablePrices: 'Free estimates with competitive pricing and warranties',
          expertTeam: 'EPA certified technicians with advanced training'
        },
        basePrice: 200,
        appointmentEnabled: false,
        isActive: true
      });
    }

    // Check existing services
    const existingServices = await Service.countDocuments();
    console.log(`Current services in database: ${existingServices}\n`);

    let createdCount = 0;

    // Create services
    for (const serviceData of sampleServices) {
      const service = new Service(serviceData);
      await service.save();
      console.log(`✅ Created service: ${serviceData.headline}`);
      createdCount++;
    }

    const totalServices = await Service.countDocuments();

    console.log('\n═══════════════════════════════════════════════════════');
    console.log('                  SEED SUMMARY                         ');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`✅ Services created: ${createdCount}`);
    console.log(`📊 Total services in database: ${totalServices}`);
    console.log('═══════════════════════════════════════════════════════\n');

    console.log('📌 Next Steps:');
    console.log('1. View services at: GET /api/services');
    console.log('2. View services by category: GET /api/services/category/:categoryId');
    console.log('3. Providers can manage at: GET /api/providers/services\n');

    await mongoose.connection.close();
    console.log('Database connection closed.');

  } catch (error) {
    console.error('\n❌ Error seeding services:', error.message);
    console.error(error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run the seed function
console.log('═══════════════════════════════════════════════════════');
console.log('          LAVELLH - SERVICE SEED SCRIPT                ');
console.log('═══════════════════════════════════════════════════════\n');

seedServices();
