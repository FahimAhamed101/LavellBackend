const mongoose = require('mongoose');
require('dotenv').config();

const Provider = require('./src/models/Provider');
const User = require('./src/models/User');
const Category = require('./src/models/Category');

async function debugNearbyProviders() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');

    // Test coordinates
    const userLat = 40.7128;
    const userLon = -74.0060;
    const maxDistance = 10000; // 10km in meters

    console.log('=== DEBUGGING NEARBY PROVIDERS ===\n');
    console.log('User Location:', { latitude: userLat, longitude: userLon });
    console.log('Max Distance:', maxDistance, 'meters (', (maxDistance / 1000).toFixed(1), 'km )\n');

    // Check all categories
    console.log('--- CATEGORIES ---');
    const categories = await Category.find({ isActive: true });
    console.log('Total Active Categories:', categories.length);
    categories.forEach(cat => {
      console.log(`  - ${cat.name} (ID: ${cat._id})`);
    });
    console.log('');

    // Check all providers
    console.log('--- PROVIDERS ---');
    const allProviders = await Provider.find({
      verificationStatus: 'verified',
      isAvailable: true
    })
      .populate({
        path: 'userId',
        select: 'fullName email phoneNumber location'
      })
      .populate('categories', 'name');

    console.log('Total Verified & Available Providers:', allProviders.length);
    console.log('');

    allProviders.forEach((provider, index) => {
      const providerUser = provider.userId;
      console.log(`Provider ${index + 1}:`);
      console.log(`  Name: ${providerUser?.fullName || 'N/A'}`);
      console.log(`  Email: ${providerUser?.email || 'N/A'}`);
      console.log(`  Provider ID: ${provider._id}`);
      console.log(`  User ID: ${provider.userId?._id || 'N/A'}`);
      console.log(`  Verification Status: ${provider.verificationStatus}`);
      console.log(`  Is Available: ${provider.isAvailable}`);
      console.log(`  Categories: ${provider.categories?.length || 0}`);
      if (provider.categories && provider.categories.length > 0) {
        provider.categories.forEach(cat => {
          console.log(`    - ${cat.name || cat}`);
        });
      } else {
        console.log('    - NO CATEGORIES ASSIGNED');
      }

      // Check location
      if (!providerUser) {
        console.log('  Location: NO USER DATA FOUND');
      } else if (!providerUser.location) {
        console.log('  Location: NO LOCATION DATA');
      } else if (!providerUser.location.coordinates || providerUser.location.coordinates.length !== 2) {
        console.log('  Location: INVALID COORDINATES');
        console.log('  Coordinates:', providerUser.location.coordinates);
      } else {
        const [providerLon, providerLat] = providerUser.location.coordinates;
        console.log(`  Location: [${providerLon}, ${providerLat}]`);

        // Calculate distance
        const distance = calculateDistance(userLat, userLon, providerLat, providerLon);
        console.log(`  Distance from user: ${Math.round(distance)} meters (${(distance / 1000).toFixed(2)} km)`);
        console.log(`  Within ${maxDistance}m radius: ${distance <= maxDistance ? 'YES ✓' : 'NO ✗'}`);
      }
      console.log('');
    });

    // Summary
    console.log('=== SUMMARY ===');
    const providersWithLocation = allProviders.filter(p =>
      p.userId &&
      p.userId.location &&
      p.userId.location.coordinates &&
      p.userId.location.coordinates.length === 2
    );

    const providersWithinRadius = providersWithLocation.filter(p => {
      const [providerLon, providerLat] = p.userId.location.coordinates;
      const distance = calculateDistance(userLat, userLon, providerLat, providerLon);
      return distance <= maxDistance;
    });

    const providersWithCategories = providersWithinRadius.filter(p =>
      p.categories && p.categories.length > 0
    );

    console.log(`Total Providers: ${allProviders.length}`);
    console.log(`Providers with valid location: ${providersWithLocation.length}`);
    console.log(`Providers within ${maxDistance}m: ${providersWithinRadius.length}`);
    console.log(`Providers with categories (will show up): ${providersWithCategories.length}`);
    console.log(`Providers without categories (will show in "Other Services"): ${providersWithinRadius.length - providersWithCategories.length}`);

    console.log('\n=== ISSUES FOUND ===');
    const issues = [];

    allProviders.forEach((provider, index) => {
      const providerUser = provider.userId;
      const providerName = providerUser?.fullName || `Provider ${index + 1}`;

      if (!providerUser) {
        issues.push(`${providerName}: No user data linked`);
      } else if (!providerUser.location || !providerUser.location.coordinates || providerUser.location.coordinates.length !== 2) {
        issues.push(`${providerName}: Missing or invalid location coordinates`);
      } else {
        const [providerLon, providerLat] = providerUser.location.coordinates;
        const distance = calculateDistance(userLat, userLon, providerLat, providerLon);
        if (distance > maxDistance) {
          issues.push(`${providerName}: Too far (${(distance / 1000).toFixed(2)} km away)`);
        }
      }

      if (!provider.categories || provider.categories.length === 0) {
        issues.push(`${providerName}: No categories assigned (will show in "Other Services")`);
      }
    });

    if (issues.length === 0) {
      console.log('No issues found! All providers should show up.');
    } else {
      issues.forEach((issue, i) => {
        console.log(`${i + 1}. ${issue}`);
      });
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\nMongoDB connection closed');
  }
}

// Haversine formula to calculate distance
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  const distance = R * c; // Distance in meters
  return distance;
}

debugNearbyProviders();
