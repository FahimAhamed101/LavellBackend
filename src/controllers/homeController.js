const Provider = require('../models/Provider');
const Service = require('../models/Service');
const Review = require('../models/Review');
const User = require('../models/User');
const Event = require('../models/Event');
const { buildImageUrl } = require('../utility/imageUrl');

/**
 * Get featured providers for home page
 * GET /api/home/featured-providers
 * Query params:
 *   - latitude: User's current latitude
 *   - longitude: User's current longitude
 *   - maxDistance: Maximum distance in meters (optional, default: 50000 = 50km)
 *   - limit: Number of providers to return (optional, default: 20)
 */
exports.getFeaturedProviders = async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      maxDistance = 50000, // 50km default
      limit = 20
    } = req.query;

    // Validate coordinates
    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const userLat = parseFloat(latitude);
    const userLon = parseFloat(longitude);

    if (isNaN(userLat) || isNaN(userLon)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid latitude or longitude'
      });
    }

    // Get current date to filter expired paid providers
    const now = new Date();

    // Find providers who are verified and available:
    // - pinned providers are always eligible for featured ranking
    // - non-pinned providers must still satisfy paid-home-screen rules
    const paidProviders = await Provider.find({
      verificationStatus: 'verified',
      isAvailable: true,
      $or: [
        { 'discoveryPin.isPinned': true },
        {
          isPaidForHomeScreen: true,
          $or: [
            { paidHomeScreenExpiresAt: null },
            { paidHomeScreenExpiresAt: { $gt: now } }
          ]
        }
      ],
    }).populate({
      path: 'userId',
      select: 'fullName email phoneNumber profilePicture location'
    });

    // Calculate distance for each provider and add to results
    const providersWithDistance = paidProviders
      .map(provider => {
        const providerUser = provider.userId;

        if (!providerUser || !providerUser.location ||
            !providerUser.location.coordinates ||
            providerUser.location.coordinates.length !== 2) {
          return null; // Skip providers without valid location
        }

        const [providerLon, providerLat] = providerUser.location.coordinates;

        // Calculate distance using Haversine formula (in meters)
        const distance = calculateDistance(
          userLat,
          userLon,
          providerLat,
          providerLon
        );

        return {
          provider,
          distance,
          providerUser
        };
      })
      .filter(item => item !== null && item.distance <= maxDistance);

    // Sort by admin pin first, then nearest distance for non-pinned providers.
    providersWithDistance.sort((a, b) =>
      comparePinnedFirst(a.provider, b.provider, () => a.distance - b.distance)
    );

    // Limit results
    const limitedProviders = providersWithDistance.slice(0, parseInt(limit));

    // Fetch services and reviews for each provider
    const providersWithDetails = await Promise.all(
      limitedProviders.map(async ({ provider, distance, providerUser }) => {
        // Get services for this provider
        const services = await Service.find({
          providerId: provider._id,
          isActive: true
        })
          .select('servicePhoto headline description basePrice appointmentEnabled appointmentSlots rating totalReviews category')
          .populate('category', 'name icon')
          .limit(5); // Limit to 5 services per provider

        // Get recent reviews
        const reviews = await Review.find({
          providerId: provider._id,
          isActive: true,
          $or: [
            { moderationStatus: { $exists: false } },
            { moderationStatus: 'active' }
          ]
        })
          .populate('userId', 'fullName profilePicture')
          .sort({ createdAt: -1 })
          .limit(3); // Get 3 most recent reviews

        return {
          providerId: provider._id,
          name: providerUser.fullName,
          profileImage: buildImageUrl(req, providerUser.profilePicture),
          address: providerUser.location?.address || 'Address not available',
          distance: Math.round(distance), // Round to nearest meter
          distanceKm: (distance / 1000).toFixed(2), // Convert to km
          activityTime: provider.activityTime || 'Not specified',
          rating: provider.rating,
          totalReviews: provider.totalReviews,
          completedJobs: provider.completedJobs,
          isAvailable: provider.isAvailable,
          occupation: provider.occupation,
          services: services.map(service => ({
            serviceId: service._id,
            serviceName: service.headline,
            serviceDetail: service.description,
            servicePhoto: buildImageUrl(req, service.servicePhoto),
            category: service.category,
            basePrice: service.basePrice,
            appointmentEnabled: service.appointmentEnabled,
            appointmentSlots: service.appointmentSlots,
            rating: service.rating,
            totalReviews: service.totalReviews
          })),
          reviews: reviews.map(review => ({
            reviewId: review._id,
            rating: review.rating,
            comment: review.comment,
            createdAt: review.createdAt,
            user: {
              name: review.userId?.fullName || 'Anonymous',
              profilePicture: buildImageUrl(req, review.userId?.profilePicture)
            }
          }))
        };
      })
    );

    res.status(200).json({
      success: true,
      message: 'Featured providers fetched successfully',
      data: {
        providers: providersWithDetails,
        count: providersWithDetails.length,
        userLocation: {
          latitude: userLat,
          longitude: userLon
        }
      }
    });

  } catch (error) {
    console.error('Get featured providers error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching featured providers',
      error: error.message
    });
  }
};

/**
 * Calculate distance between two coordinates using Haversine formula
 * Returns distance in meters
 */
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

function isValidLatitudeLongitude(latitude, longitude) {
  return Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180;
}

function resolveSearchCoordinates(req) {
  const hasLatitude = req.query.latitude !== undefined;
  const hasLongitude = req.query.longitude !== undefined;

  if (hasLatitude || hasLongitude) {
    const parsedLatitude = parseFloat(req.query.latitude);
    const parsedLongitude = parseFloat(req.query.longitude);

    if (!isValidLatitudeLongitude(parsedLatitude, parsedLongitude)) {
      return {
        error: 'Invalid latitude or longitude'
      };
    }

    return {
      latitude: parsedLatitude,
      longitude: parsedLongitude
    };
  }

  const rawCoordinates = req.user?.location?.coordinates;
  if (Array.isArray(rawCoordinates) && rawCoordinates.length === 2) {
    const parsedLongitude = Number(rawCoordinates[0]);
    const parsedLatitude = Number(rawCoordinates[1]);

    if (
      isValidLatitudeLongitude(parsedLatitude, parsedLongitude) &&
      !(parsedLatitude === 0 && parsedLongitude === 0)
    ) {
      return {
        latitude: parsedLatitude,
        longitude: parsedLongitude
      };
    }
  }

  return {
    error: 'Location not available. Please enable location and update your profile location.'
  };
}

function resolveMaxDistance(rawValue, fallbackValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '') {
    return fallbackValue;
  }

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return Math.round(parsedValue);
}

function getPinRank(entity) {
  const discoveryPin = entity?.discoveryPin;
  const isPinned = discoveryPin?.isPinned === true;
  const pinOrder = Number.isInteger(discoveryPin?.pinOrder)
    ? discoveryPin.pinOrder
    : Number.MAX_SAFE_INTEGER;
  const pinnedAt = discoveryPin?.pinnedAt ? new Date(discoveryPin.pinnedAt).getTime() : Number.MAX_SAFE_INTEGER;
  const fallbackId = String(entity?._id || '');

  return { isPinned, pinOrder, pinnedAt, fallbackId };
}

function comparePinnedFirst(entityA, entityB, fallbackComparator) {
  const rankA = getPinRank(entityA);
  const rankB = getPinRank(entityB);

  if (rankA.isPinned !== rankB.isPinned) {
    return rankA.isPinned ? -1 : 1;
  }

  if (rankA.isPinned && rankA.pinOrder !== rankB.pinOrder) {
    return rankA.pinOrder - rankB.pinOrder;
  }

  if (rankA.isPinned && rankA.pinnedAt !== rankB.pinnedAt) {
    return rankA.pinnedAt - rankB.pinnedAt;
  }

  const fallbackResult = fallbackComparator ? fallbackComparator(entityA, entityB) : 0;
  if (fallbackResult !== 0) {
    return fallbackResult;
  }

  return rankA.fallbackId.localeCompare(rankB.fallbackId);
}

/**
 * Get all categories with provider count
 * GET /api/home/categories
 */
exports.getHomeCategories = async (req, res) => {
  try {
    const Category = require('../models/Category');

    const categories = await Category.find({ isActive: true }).sort({ name: 1 });

    // Count providers for each category
    const categoriesWithCount = await Promise.all(
      categories.map(async category => {
        const providerCount = await Provider.countDocuments({
          categories: category._id,
          verificationStatus: 'verified',
          isAvailable: true
        });

        return {
          categoryId: category._id,
          name: category.name,
          icon: category.icon,
          description: category.description,
          providerCount
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        categories: categoriesWithCount,
        count: categoriesWithCount.length
      }
    });

  } catch (error) {
    console.error('Get home categories error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching categories',
      error: error.message
    });
  }
};

/**
 * Get provider details for home page
 * GET /api/home/provider/:providerId
 */
exports.getProviderDetails = async (req, res) => {
  try {
    const { providerId } = req.params;
    const { latitude, longitude } = req.query;

    const provider = await Provider.findById(providerId)
      .populate({
        path: 'userId',
        select: 'fullName email phoneNumber profilePicture location'
      })
      .populate('categories', 'name icon');

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    if (provider.verificationStatus !== 'verified') {
      return res.status(403).json({
        success: false,
        message: 'Provider is not verified'
      });
    }

    const providerUser = provider.userId;

    // Calculate distance if user location provided
    let distance = null;
    let distanceKm = null;

    if (latitude && longitude && providerUser.location?.coordinates) {
      const [providerLon, providerLat] = providerUser.location.coordinates;
      distance = Math.round(calculateDistance(
        parseFloat(latitude),
        parseFloat(longitude),
        providerLat,
        providerLon
      ));
      distanceKm = (distance / 1000).toFixed(2);
    }

    // Get all services
    const services = await Service.find({
      providerId: provider._id,
      isActive: true
    })
      .populate('category', 'name icon')
      .sort({ createdAt: -1 });

    // Get all reviews
    const reviews = await Review.find({
      providerId: provider._id,
      isActive: true,
      $or: [
        { moderationStatus: { $exists: false } },
        { moderationStatus: 'active' }
      ]
    })
      .populate('userId', 'fullName profilePicture')
      .sort({ createdAt: -1 });

    // Get portfolio
    const Portfolio = require('../models/Portfolio');
    const portfolio = await Portfolio.find({
      providerId: provider._id,
      isActive: true
    }).sort({ displayOrder: 1, createdAt: -1 });

    res.status(200).json({
      success: true,
      data: {
        provider: {
          providerId: provider._id,
          name: providerUser.fullName,
          email: providerUser.email,
          phoneNumber: providerUser.phoneNumber,
          profileImage: buildImageUrl(req, providerUser.profilePicture),
          address: providerUser.location?.address || 'Address not available',
          distance: distance,
          distanceKm: distanceKm,
          activityTime: provider.activityTime || 'Not specified',
          rating: provider.rating,
          totalReviews: provider.totalReviews,
          completedJobs: provider.completedJobs,
          isAvailable: provider.isAvailable,
          occupation: provider.occupation,
          categories: provider.categories
        },
        services: services.map(service => ({
          serviceId: service._id,
          serviceName: service.headline,
          serviceDetail: service.description,
          servicePhoto: buildImageUrl(req, service.servicePhoto),
          category: service.category,
          basePrice: service.basePrice,
          appointmentEnabled: service.appointmentEnabled,
          appointmentSlots: service.appointmentSlots,
          whyChooseUs: service.whyChooseUs,
          rating: service.rating,
          totalReviews: service.totalReviews,
          views: service.views,
          bookings: service.bookings
        })),
        reviews: reviews.map(review => ({
          reviewId: review._id,
          rating: review.rating,
          comment: review.comment,
          createdAt: review.createdAt,
          user: {
            name: review.userId?.fullName || 'Anonymous',
            profilePicture: buildImageUrl(req, review.userId?.profilePicture)
          }
        })),
        portfolio: portfolio.map(item => ({
          portfolioId: item._id,
          title: item.title,
          beforeImage: buildImageUrl(req, item.beforeImage),
          afterImage: buildImageUrl(req, item.afterImage),
          about: item.about,
          serviceType: item.serviceType
        }))
      }
    });

  } catch (error) {
    console.error('Get provider details error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching provider details',
      error: error.message
    });
  }
};

/**
 * Get nearby providers grouped by category
 * GET /api/home/nearby-providers
 * Query params:
 *   - latitude: User's current latitude (optional if user profile has location)
 *   - longitude: User's current longitude (optional if user profile has location)
 *   - maxDistance: Maximum distance in meters (optional, default: 10000 = 10km)
 */
exports.getNearbyProvidersByCategory = async (req, res) => {
  try {
    const maxDistance = resolveMaxDistance(req.query.maxDistance, 10000);
    if (maxDistance === null) {
      return res.status(400).json({
        success: false,
        message: 'Invalid maxDistance value'
      });
    }

    const resolvedCoordinates = resolveSearchCoordinates(req);
    if (resolvedCoordinates.error) {
      return res.status(400).json({
        success: false,
        message: resolvedCoordinates.error
      });
    }

    const userLat = resolvedCoordinates.latitude;
    const userLon = resolvedCoordinates.longitude;

    // Get all active categories
    const Category = require('../models/Category');
    const categories = await Category.find({ isActive: true }).sort({ displayOrder: 1, name: 1 });

    // Get all verified and available providers
    const providers = await Provider.find({
      verificationStatus: { $in: ['verified', 'approved'] },
      isAvailable: true
    })
      .populate({
        path: 'userId',
        select: 'fullName profilePicture location'
      })
      .populate('categories', 'name icon description');

    // Calculate distance for each provider and filter by maxDistance
    const providersWithDistance = providers
      .map(provider => {
        const providerUser = provider.userId;

        if (!providerUser || !providerUser.location ||
            !providerUser.location.coordinates ||
            providerUser.location.coordinates.length !== 2) {
          return null;
        }

        const [providerLon, providerLat] = providerUser.location.coordinates;

        // Calculate distance using Haversine formula (in meters)
        const distance = calculateDistance(
          userLat,
          userLon,
          providerLat,
          providerLon
        );

        if (distance > maxDistance) {
          return null; // Filter out providers beyond maxDistance
        }

        return {
          providerId: provider._id,
          name: providerUser.fullName,
          profileImage: buildImageUrl(req, providerUser.profilePicture),
          address: providerUser.location?.address || 'Address not available',
          distance: Math.round(distance), // Distance in meters
          distanceKm: (distance / 1000).toFixed(1), // Distance in km with 1 decimal
          activityTime: provider.activityTime || 'Not specified',
          rating: provider.rating,
          totalReviews: provider.totalReviews,
          completedJobs: provider.completedJobs,
          occupation: provider.occupation,
          categories: provider.categories, // All categories this provider belongs to
          _pin: provider.discoveryPin || null
        };
      })
      .filter(item => item !== null);

    providersWithDistance.sort((a, b) =>
      comparePinnedFirst(
        { _id: a.providerId, discoveryPin: a._pin },
        { _id: b.providerId, discoveryPin: b._pin },
        () => a.distance - b.distance
      )
    );
    const rankedProviders = providersWithDistance.map(({ _pin, ...provider }) => provider);

    const providerIds = providersWithDistance.map(provider => provider.providerId);
    const providerDistanceMap = new Map(
      providersWithDistance.map(provider => [provider.providerId.toString(), provider.distance])
    );

    const services = await Service.find({
      providerId: { $in: providerIds },
      isActive: true
    }).select('providerId category');

    const categoryProviderMap = new Map();
    services.forEach((service) => {
      if (!service.category) return;
      const categoryId = service.category.toString();
      if (!categoryProviderMap.has(categoryId)) {
        categoryProviderMap.set(categoryId, new Set());
      }
      categoryProviderMap.get(categoryId).add(service.providerId.toString());
    });

    // Group providers by category based on services
    const categoriesWithProviders = categories.map(category => {
      const providerSet = categoryProviderMap.get(category._id.toString()) || new Set();
      const providerDistances = Array.from(providerSet)
        .map(providerId => providerDistanceMap.get(providerId))
        .filter(distance => distance !== undefined);

      const totalDistance = providerDistances.reduce((sum, distance) => sum + distance, 0);
      const averageDistance =
        providerDistances.length > 0 ? Math.round(totalDistance / providerDistances.length) : null;

      return {
        categoryId: category._id,
        categoryName: category.name,
        categoryImage: category.icon,
        averageDistance,
        averageDistanceKm: averageDistance !== null ? (averageDistance / 1000).toFixed(1) : null,
        providerCount: providerSet.size
      };
    });

    // Find providers without any active services/categories
    const providersWithoutCategory = providersWithDistance.filter(provider => {
      const providerId = provider.providerId.toString();
      for (const providerSet of categoryProviderMap.values()) {
        if (providerSet.has(providerId)) {
          return false;
        }
      }
      return true;
    });

    // If there are providers without categories, add them to an "Uncategorized" group
    if (providersWithoutCategory.length > 0) {
      providersWithoutCategory.sort((a, b) => a.distance - b.distance);

      const totalDistance = providersWithoutCategory.reduce((sum, p) => sum + p.distance, 0);
      const averageDistance =
        providersWithoutCategory.length > 0
          ? Math.round(totalDistance / providersWithoutCategory.length)
          : null;

      categoriesWithProviders.push({
        categoryId: null,
        categoryName: 'Other Services',
        categoryImage: null,
        averageDistance,
        averageDistanceKm: averageDistance !== null ? (averageDistance / 1000).toFixed(1) : null,
        providerCount: providersWithoutCategory.length
      });
    }

    res.status(200).json({
      success: true,
      message: 'Nearby providers fetched successfully',
      data: {
        categories: categoriesWithProviders,
        providers: rankedProviders,
        totalCategories: categoriesWithProviders.length,
        totalProviders: rankedProviders.length,
        searchRadius: {
          meters: maxDistance,
          kilometers: (maxDistance / 1000).toFixed(1)
        },
        userLocation: {
          latitude: userLat,
          longitude: userLon
        }
      }
    });

  } catch (error) {
    console.error('Get nearby providers by category error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching nearby providers',
      error: error.message
    });
  }
};

/**
 * Get nearby providers for a specific category
 * GET /api/home/nearby-providers/category/:categoryId
 * Query params:
 *   - latitude: User's current latitude (optional if user profile has location)
 *   - longitude: User's current longitude (optional if user profile has location)
 *   - maxDistance: Maximum distance in meters (optional, default: 10000 = 10km)
 */
exports.getNearbyProvidersByCategoryId = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const maxDistance = resolveMaxDistance(req.query.maxDistance, 10000);
    if (maxDistance === null) {
      return res.status(400).json({
        success: false,
        message: 'Invalid maxDistance value'
      });
    }

    const resolvedCoordinates = resolveSearchCoordinates(req);
    if (resolvedCoordinates.error) {
      return res.status(400).json({
        success: false,
        message: resolvedCoordinates.error
      });
    }

    const userLat = resolvedCoordinates.latitude;
    const userLon = resolvedCoordinates.longitude;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category id'
      });
    }

    const Category = require('../models/Category');
    const category = await Category.findById(categoryId).select('_id');
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const services = await Service.find({
      category: categoryId,
      isActive: true
    })
      .populate('category', 'name icon description');

    const providerIds = [...new Set(services.map(service => service.providerId.toString()))];

    if (providerIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Nearby providers fetched successfully',
        data: {
          providers: [],
          totalProviders: 0,
          searchRadius: {
            meters: maxDistance,
            kilometers: (maxDistance / 1000).toFixed(1)
          },
          userLocation: {
            latitude: userLat,
            longitude: userLon
          }
        }
      });
    }

    const providers = await Provider.find({
      _id: { $in: providerIds },
      verificationStatus: { $in: ['verified', 'approved'] },
      isAvailable: true
    })
      .populate({
        path: 'userId',
        select: 'fullName profilePicture location'
      })
      .populate('categories', 'name icon description');

    const servicesByProvider = new Map();
    services.forEach((service) => {
      const key = service.providerId.toString();
      if (!servicesByProvider.has(key)) {
        servicesByProvider.set(key, []);
      }
      servicesByProvider.get(key).push(service);
    });

    const providersWithDistance = providers
      .map(provider => {
        const providerUser = provider.userId;
        if (!providerUser || !providerUser.location ||
            !providerUser.location.coordinates ||
            providerUser.location.coordinates.length !== 2) {
          return null;
        }

        const [providerLon, providerLat] = providerUser.location.coordinates;
        const distance = calculateDistance(
          userLat,
          userLon,
          providerLat,
          providerLon
        );

        if (distance > maxDistance) {
          return null;
        }

        const providerServices = servicesByProvider.get(provider._id.toString()) || [];

        return {
          providerId: provider._id,
          name: providerUser.fullName,
          profileImage: buildImageUrl(req, providerUser.profilePicture),
          address: providerUser.location?.address || 'Address not available',
          distance: Math.round(distance),
          distanceKm: (distance / 1000).toFixed(1),
          services: providerServices.map(service => ({
            serviceId: service._id,
            title: service.headline,
            description: service.description,
            rating: service.rating,
            totalReviews: service.totalReviews,
            price: service.basePrice,
            image: buildImageUrl(req, service.servicePhoto),
            appointmentEnabled: service.appointmentEnabled
          })),
          _pin: provider.discoveryPin || null
        };
      })
      .filter(item => item !== null);

    providersWithDistance.sort((a, b) =>
      comparePinnedFirst(
        { _id: a.providerId, discoveryPin: a._pin },
        { _id: b.providerId, discoveryPin: b._pin },
        () => a.distance - b.distance
      )
    );

    const rankedProviders = providersWithDistance.map(({ _pin, ...provider }) => provider);

    res.status(200).json({
      success: true,
      message: 'Nearby providers fetched successfully',
      data: {
        providers: rankedProviders,
        totalProviders: rankedProviders.length,
        searchRadius: {
          meters: maxDistance,
          kilometers: (maxDistance / 1000).toFixed(1)
        },
        userLocation: {
          latitude: userLat,
          longitude: userLon
        }
      }
    });
  } catch (error) {
    console.error('Get nearby providers by category id error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching nearby providers',
      error: error.message
    });
  }
};

/**
 * Get providers for a specific category (no distance filter)
 * GET /api/home/providers/category/:categoryId
 */
exports.getProvidersByCategoryId = async (req, res) => {
  try {
    const { categoryId } = req.params;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid category id'
      });
    }

    const Category = require('../models/Category');
    const category = await Category.findById(categoryId).select('_id');
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const services = await Service.find({
      category: categoryId,
      isActive: true
    })
      .populate('category', 'name icon description');

    const providerIds = [...new Set(services.map(service => service.providerId.toString()))];

    if (providerIds.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'Providers fetched successfully',
        data: {
          providers: [],
          totalProviders: 0
        }
      });
    }

    const providers = await Provider.find({
      _id: { $in: providerIds },
      verificationStatus: 'verified',
      isAvailable: true
    })
      .populate({
        path: 'userId',
        select: 'fullName profilePicture location'
      })
      .populate('categories', 'name icon description');

    const servicesByProvider = new Map();
    services.forEach((service) => {
      const key = service.providerId.toString();
      if (!servicesByProvider.has(key)) {
        servicesByProvider.set(key, []);
      }
      servicesByProvider.get(key).push(service);
    });

    const providersWithServices = providers.map(provider => {
      const providerUser = provider.userId;
      const providerServices = servicesByProvider.get(provider._id.toString()) || [];

      return {
        providerId: provider._id,
        name: providerUser?.fullName,
        profileImage: buildImageUrl(req, providerUser?.profilePicture),
        address: providerUser?.location?.address || 'Address not available',
        services: providerServices.map(service => ({
          serviceId: service._id,
          title: service.headline,
          description: service.description,
          rating: service.rating,
          totalReviews: service.totalReviews,
          price: service.basePrice,
          image: buildImageUrl(req, service.servicePhoto),
          appointmentEnabled: service.appointmentEnabled
        })),
        _pin: provider.discoveryPin || null
      };
    });

    providersWithServices.sort((a, b) =>
      comparePinnedFirst(
        { _id: a.providerId, discoveryPin: a._pin },
        { _id: b.providerId, discoveryPin: b._pin }
      )
    );

    const rankedProviders = providersWithServices.map(({ _pin, ...provider }) => provider);

    res.status(200).json({
      success: true,
      message: 'Providers fetched successfully',
      data: {
        providers: rankedProviders,
        totalProviders: rankedProviders.length
      }
    });
  } catch (error) {
    console.error('Get providers by category id error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching providers',
      error: error.message
    });
  }
};

/**
 * Get all providers (for testing/debugging)
 * GET /api/home/all-providers
 */
exports.getAllProviders = async (req, res) => {
  try {
    const providers = await Provider.find({
      verificationStatus: 'verified'
    })
      .populate('userId', 'fullName email profilePicture location')
      .limit(50);

    const providerList = providers.map(provider => ({
      providerId: provider._id,
      name: provider.userId?.fullName,
      email: provider.userId?.email,
      isPaidForHomeScreen: provider.isPaidForHomeScreen,
      isAvailable: provider.isAvailable,
      rating: provider.rating,
      totalReviews: provider.totalReviews
    }));

    res.status(200).json({
      success: true,
      data: {
        providers: providerList,
        count: providerList.length
      }
    });

  } catch (error) {
    console.error('Get all providers error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching providers',
      error: error.message
    });
  }
};

// ===========================
// EVENT DISCOVERY FUNCTIONS
// ===========================

/**
 * Helper function to format event date for display
 */
function formatEventDate(dateTime) {
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return new Date(dateTime).toLocaleDateString('en-US', options);
}

/**
 * Helper function to format event time range for display
 */
function formatEventTime(startDateTime, endDateTime) {
  const options = { hour: 'numeric', minute: '2-digit', hour12: true };
  const start = new Date(startDateTime).toLocaleTimeString('en-US', options);
  const end = new Date(endDateTime).toLocaleTimeString('en-US', options);
  return `${start} - ${end}`;
}

/**
 * Helper function to format events for display
 */
function formatEventsForDisplay(events) {
  return events.map(event => ({
    eventId: event._id,
    eventName: event.eventName,
    eventImage: event.eventImage,
    eventType: event.eventType,
    eventLocation: event.eventLocation,
    eventStartDateTime: event.eventStartDateTime,
    eventEndDateTime: event.eventEndDateTime,
    ticketPrice: event.ticketPrice,
    ticketsAvailable: event.ticketsAvailable,
    ticketsSold: event.ticketsSold,
    rating: event.rating || 0,
    totalReviews: event.totalReviews || 0,
    eventManagerName: event.eventManagerName,
    formattedDate: formatEventDate(event.eventStartDateTime),
    formattedTime: formatEventTime(event.eventStartDateTime, event.eventEndDateTime)
  }));
}

/**
 * Get popular events sorted by tickets sold
 * GET /api/home/popular-events
 * Query params:
 *   - limit: Number of events to return (optional, default: 20, max: 100)
 *   - eventType: Filter by event type (optional)
 */
exports.getPopularEvents = async (req, res) => {
  try {
    const { limit = 20, eventType } = req.query;

    const query = { status: 'published' };
    if (eventType) {
      query.eventType = eventType;
    }

    const events = await Event.find(query)
      .sort({ ticketsSold: -1, rating: -1, eventStartDateTime: 1 })
      .limit(Math.min(parseInt(limit), 100));

    res.status(200).json({
      success: true,
      data: {
        events: formatEventsForDisplay(events),
        count: events.length
      }
    });
  } catch (error) {
    console.error('Error fetching popular events:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch events'
    });
  }
};

/**
 * Get event categories with counts
 * GET /api/home/event-categories
 */
exports.getEventCategories = async (req, res) => {
  try {
    const eventTypes = [
      'Concert/Music Show',
      'Cultural Program',
      'Seminar/Conference',
      'Sports Event',
      'Festival/Fair'
    ];

    const now = new Date();

    const categoriesWithCount = await Promise.all(
      eventTypes.map(async (type) => {
        const count = await Event.countDocuments({
          eventType: type,
          status: 'published',
          ticketSalesStartDate: { $lte: now },
          ticketSalesEndDate: { $gte: now },
          eventStartDateTime: { $gt: now }
        });

        return {
          eventType: type,
          displayName: type,
          availableEventCount: count
        };
      })
    );

    res.status(200).json({
      success: true,
      data: {
        categories: categoriesWithCount.filter(cat => cat.availableEventCount > 0)
      }
    });
  } catch (error) {
    console.error('Error fetching event categories:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch categories'
    });
  }
};

/**
 * Get event details
 * GET /api/home/event/:eventId
 */
exports.getEventDetails = async (req, res) => {
  try {
    const { eventId } = req.params;

    const event = await Event.findById(eventId);

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const now = new Date();
    const isAvailableForPurchase =
      event.status === 'published' &&
      now >= event.ticketSalesStartDate &&
      now <= event.ticketSalesEndDate &&
      !event.isSoldOut &&
      event.eventStartDateTime > now;

    res.status(200).json({
      success: true,
      data: {
        event: {
          eventId: event._id,
          eventName: event.eventName,
          eventImage: event.eventImage,
          eventType: event.eventType,
          eventDescription: event.eventDescription,
          eventLocation: event.eventLocation,
          eventManagerName: event.eventManagerName,
          eventStartDateTime: event.eventStartDateTime,
          eventEndDateTime: event.eventEndDateTime,
          ticketPrice: event.ticketPrice,
          ticketsAvailable: event.ticketsAvailable,
          ticketsSold: event.ticketsSold,
          maximumNumberOfTickets: event.maximumNumberOfTickets,
          isAvailableForPurchase,
          isSoldOut: event.isSoldOut,
          formattedDate: formatEventDate(event.eventStartDateTime),
          formattedTime: formatEventTime(event.eventStartDateTime, event.eventEndDateTime)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching event details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch event details'
    });
  }
};
