const Service = require('../models/Service');
const Provider = require('../models/Provider');
const Review = require('../models/Review');
const Category = require('../models/Category');
const Portfolio = require('../models/Portfolio');
const { uploadToCloudinary } = require('../utility/cloudinary');

/**
 * Create Service (Provider only)
 * POST /api/providers/services
 */
exports.createService = async (req, res) => {
  try {
    const {
      category,
      headline,
      description,
      whyChooseUs,
      basePrice,
      appointmentEnabled,
      appointmentSlots
    } = req.body;

    // Validate file upload
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Service photo is required'
      });
    }

    // Validate required fields
    if (!category || !headline || !description) {
      return res.status(400).json({
        success: false,
        message: 'Category, headline, and description are required'
      });
    }

    // Verify category exists
    const categoryExists = await Category.findById(category);
    if (!categoryExists) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Verify provider exists (from auth middleware, req.user should have provider info)
    const provider = await Provider.findOne({ userId: req.user._id });
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found. Please complete provider registration first.'
      });
    }

    // Parse appointment data
    const isAppointmentEnabled = appointmentEnabled === 'true' || appointmentEnabled === true;
    const parsedAppointmentSlots = appointmentSlots ? JSON.parse(appointmentSlots) : [];
    const parsedWhyChooseUs = whyChooseUs ? JSON.parse(whyChooseUs) : {};

    // Validate appointment logic
    if (isAppointmentEnabled) {
      if (!parsedAppointmentSlots || parsedAppointmentSlots.length === 0) {
        return res.status(400).json({
          success: false,
          message: 'At least one appointment slot is required when appointment is enabled'
        });
      }
    } else {
      if (!basePrice || parseFloat(basePrice) <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Base price is required when appointment is disabled'
        });
      }
    }

    // Upload image to Cloudinary
    const uploadResult = await uploadToCloudinary(req.file.path, 'services');

    if (!uploadResult.success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to upload service photo',
        error: uploadResult.error
      });
    }

    // Create service
    const service = new Service({
      providerId: provider._id,
      servicePhoto: uploadResult.url,
      category,
      headline,
      description,
      whyChooseUs: parsedWhyChooseUs,
      basePrice: isAppointmentEnabled ? 0 : parseFloat(basePrice),
      appointmentEnabled: isAppointmentEnabled,
      appointmentSlots: isAppointmentEnabled ? parsedAppointmentSlots : []
    });

    await service.save();

    // Populate category and provider info
    await service.populate('category', 'name slug icon');
    await service.populate({
      path: 'providerId',
      select: 'rating totalReviews',
      populate: {
        path: 'userId',
        select: 'fullName profilePicture'
      }
    });

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      data: {
        service
      }
    });

  } catch (error) {
    console.error('Create service error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while creating service',
      error: error.message
    });
  }
};

/**
 * Get All Services by Provider (Provider's own services)
 * GET /api/providers/services
 */
exports.getProviderServices = async (req, res) => {
  try {
    const { page = 1, limit = 10, isActive } = req.query;

    // Get provider
    const provider = await Provider.findOne({ userId: req.user._id })
      .populate('userId', 'fullName location profilePicture');
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    const query = { providerId: provider._id };

    // Filter by active status if provided
    if (isActive !== undefined) {
      query.isActive = isActive === 'true';
    }

    const services = await Service.find(query)
      .populate('category', 'name slug icon')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Service.countDocuments(query);
    const providerName = provider.userId?.fullName || '';
    const providerLocation = provider.userId?.location || null;
    const providerProfilePicture = provider.userId?.profilePicture || null;
    const servicesWithProvider = services.map(service => ({
      ...service.toObject(),
      providerName,
      providerLocation,
      providerProfilePicture
    }));

    res.status(200).json({
      success: true,
      data: {
        services: servicesWithProvider,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page),
        total: count
      }
    });

  } catch (error) {
    console.error('Get provider services error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching services',
      error: error.message
    });
  }
};

/**
 * Get Single Service by ID (Provider)
 * GET /api/providers/services/:id
 */
exports.getProviderServiceById = async (req, res) => {
  try {
    const { id } = req.params;

    // Get provider
    const provider = await Provider.findOne({ userId: req.user._id })
      .populate('userId', 'fullName location profilePicture');
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    const service = await Service.findOne({ _id: id, providerId: provider._id })
      .populate('category', 'name slug icon description');

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        service: {
          ...service.toObject(),
          providerName: provider.userId?.fullName || '',
          providerLocation: provider.userId?.location || null,
          providerProfilePicture: provider.userId?.profilePicture || null
        }
      }
    });

  } catch (error) {
    console.error('Get service by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching service',
      error: error.message
    });
  }
};

/**
 * Update Service (Provider only)
 * PUT /api/providers/services/:id
 */
exports.updateService = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      category,
      headline,
      description,
      whyChooseUs,
      basePrice,
      appointmentEnabled,
      appointmentSlots,
      isActive
    } = req.body || {};

    // Get provider
    const provider = await Provider.findOne({ userId: req.user._id });
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    const service = await Service.findOne({ _id: id, providerId: provider._id });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Verify category if being updated
    if (category && category !== service.category.toString()) {
      const categoryExists = await Category.findById(category);
      if (!categoryExists) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }
    }

    // Update fields
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file.path, 'services');
      if (!uploadResult.success) {
        return res.status(500).json({
          success: false,
          message: 'Failed to upload service photo'
        });
      }
      service.servicePhoto = uploadResult.url;
    }
    if (category !== undefined) service.category = category;
    if (headline !== undefined) service.headline = headline;
    if (description !== undefined) service.description = description;
    if (whyChooseUs !== undefined) {
      try {
        service.whyChooseUs = typeof whyChooseUs === 'string' ? JSON.parse(whyChooseUs) : whyChooseUs;
      } catch (error) {
        return res.status(400).json({
          success: false,
          message: 'Invalid whyChooseUs format'
        });
      }
    }
    if (isActive !== undefined) service.isActive = isActive;

    // Handle appointment toggle
    if (appointmentEnabled !== undefined) {
      const isAppointmentEnabled = appointmentEnabled === 'true' || appointmentEnabled === true;
      service.appointmentEnabled = isAppointmentEnabled;

      if (isAppointmentEnabled) {
        // Appointment is ON - require slots
        if (!appointmentSlots) {
          return res.status(400).json({
            success: false,
            message: 'At least one appointment slot is required when appointment is enabled'
          });
        }
        try {
          service.appointmentSlots = Array.isArray(appointmentSlots)
            ? appointmentSlots
            : JSON.parse(appointmentSlots);
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: 'Invalid appointmentSlots format'
          });
        }
      } else {
        // Appointment is OFF - require base price
        if (basePrice === undefined || parseFloat(basePrice) <= 0) {
          return res.status(400).json({
            success: false,
            message: 'Base price is required when appointment is disabled'
          });
        }
        service.basePrice = parseFloat(basePrice);
        service.appointmentSlots = [];
      }
    } else {
      // If appointment toggle not changed, update respective fields
      if (service.appointmentEnabled && appointmentSlots !== undefined) {
        try {
          service.appointmentSlots = Array.isArray(appointmentSlots)
            ? appointmentSlots
            : JSON.parse(appointmentSlots);
        } catch (error) {
          return res.status(400).json({
            success: false,
            message: 'Invalid appointmentSlots format'
          });
        }
      }
      if (!service.appointmentEnabled && basePrice !== undefined) {
        service.basePrice = parseFloat(basePrice);
      }
    }

    await service.save();

    // Populate for response
    await service.populate('category', 'name slug icon');

    res.status(200).json({
      success: true,
      message: 'Service updated successfully',
      data: {
        service
      }
    });

  } catch (error) {
    console.error('Update service error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating service',
      error: error.message
    });
  }
};

/**
 * Delete Service (Provider only)
 * DELETE /api/providers/services/:id
 */
exports.deleteService = async (req, res) => {
  try {
    const { id } = req.params;

    // Get provider
    const provider = await Provider.findOne({ userId: req.user._id });
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    const service = await Service.findOne({ _id: id, providerId: provider._id });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    await service.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Service deleted successfully'
    });

  } catch (error) {
    console.error('Delete service error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting service',
      error: error.message
    });
  }
};

/**
 * Toggle Service Active Status (Provider only)
 * PUT /api/providers/services/:id/toggle-status
 */
exports.toggleServiceStatus = async (req, res) => {
  try {
    const { id } = req.params;

    // Get provider
    const provider = await Provider.findOne({ userId: req.user._id });
    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider profile not found'
      });
    }

    const service = await Service.findOne({ _id: id, providerId: provider._id });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    service.isActive = !service.isActive;
    await service.save();

    res.status(200).json({
      success: true,
      message: `Service ${service.isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        service
      }
    });

  } catch (error) {
    console.error('Toggle service status error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while toggling service status',
      error: error.message
    });
  }
};

// ============ PUBLIC ENDPOINTS (For Users) ============

/**
 * Get All Services (Public)
 * GET /api/services
 */
exports.getAllServices = async (req, res) => {
  try {
    const {
      category,
      minPrice,
      maxPrice,
      sortBy = 'createdAt',
      order = 'desc',
      page = 1,
      limit = 12,
      search
    } = req.query;

    const EmployeeService = require('../models/EmployeeService');
    
    // Build query for provider services
    const providerQuery = { isActive: true };

    // Filter by category
    if (category) {
      providerQuery.category = category;
    }

    // Search in headline and description
    if (search) {
      providerQuery.$or = [
        { headline: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    // Price filter
    if (minPrice || maxPrice) {
      const priceQuery = [];

      if (minPrice) {
        priceQuery.push({ basePrice: { $gte: parseFloat(minPrice) } });
      }
      if (maxPrice) {
        priceQuery.push({ basePrice: { $lte: parseFloat(maxPrice) } });
      }

      if (priceQuery.length > 0) {
        providerQuery.$and = priceQuery;
      }
    }

    // Build query for employee services (business owner)
    const employeeQuery = { isActive: true };

    if (category) {
      employeeQuery.categories = category;
    }

    if (search) {
      employeeQuery.$or = [
        { headline: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } }
      ];
    }

    if (minPrice || maxPrice) {
      const priceQuery = [];

      if (minPrice) {
        priceQuery.push({ basePrice: { $gte: parseFloat(minPrice) } });
      }
      if (maxPrice) {
        priceQuery.push({ basePrice: { $lte: parseFloat(maxPrice) } });
      }

      if (priceQuery.length > 0) {
        employeeQuery.$and = priceQuery;
      }
    }

    // Sorting
    const sortOptions = {};
    sortOptions[sortBy] = order === 'asc' ? 1 : -1;

    // Fetch both provider and employee services
    const [providerServices, employeeServices] = await Promise.all([
      Service.find(providerQuery)
        .populate('category', 'name slug icon')
        .populate({
          path: 'providerId',
          select: 'rating totalReviews',
          populate: {
            path: 'userId',
            select: 'fullName profilePicture'
          }
        })
        .sort(sortOptions),
      EmployeeService.find(employeeQuery)
        .populate('categories', 'name slug icon')
        .populate({
          path: 'businessOwnerId',
          select: 'rating totalReviews',
          populate: {
            path: 'userId',
            select: 'fullName profilePicture'
          }
        })
        .sort(sortOptions)
    ]);

    // Combine and transform services
    const combinedServices = [
      ...providerServices.map(service => ({
        ...service.toObject(),
        serviceType: 'provider'
      })),
      ...employeeServices.map(service => ({
        ...service.toObject(),
        serviceType: 'business_owner'
      }))
    ];

    // Re-sort combined results
    const sortedServices = combinedServices.sort((a, b) => {
      const aVal = a[sortBy] || 0;
      const bVal = b[sortBy] || 0;
      
      if (aVal < bVal) return order === 'asc' ? -1 : 1;
      if (aVal > bVal) return order === 'asc' ? 1 : -1;
      return 0;
    });

    // Paginate
    const startIndex = (page - 1) * limit;
    const paginatedServices = sortedServices.slice(startIndex, startIndex + limit);

    const total = combinedServices.length;

    res.status(200).json({
      success: true,
      data: {
        services: paginatedServices,
        totalPages: Math.ceil(total / limit),
        currentPage: parseInt(page),
        total: total
      }
    });

  } catch (error) {
    console.error('Get all services error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching services',
      error: error.message
    });
  }
};

/**
 * Get Single Service by ID (Public)
 * GET /api/services/:id
 */
exports.getServiceById = async (req, res) => {
  try {
    const { id } = req.params;

    const service = await Service.findOne({ _id: id, isActive: true })
      .populate('category', 'name slug icon description')
      .populate({
        path: 'providerId',
        select: 'rating totalReviews completedJobs',
        populate: {
          path: 'userId',
          select: 'fullName email phoneNumber profilePicture'
        }
      });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Increment views
    await service.incrementViews();

    res.status(200).json({
      success: true,
      data: {
        service
      }
    });

  } catch (error) {
    console.error('Get service by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching service',
      error: error.message
    });
  }
};

/**
 * Get Service Details (Authenticated User)
 * GET /api/user/services/:id
 */
exports.getServiceDetailForUser = async (req, res) => {
  try {
    const { id } = req.params;

    const service = await Service.findOne({ _id: id, isActive: true })
      .populate({
        path: 'providerId',
        select: 'rating totalReviews activityTime',
        populate: {
          path: 'userId',
          select: 'fullName profilePicture location'
        }
      });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    const providerUser = service.providerId?.userId;

    const reviews = await Review.find({
      serviceId: service._id,
      isActive: true,
      $or: [
        { moderationStatus: { $exists: false } },
        { moderationStatus: 'active' }
      ]
    })
      .populate('userId', 'fullName profilePicture')
      .sort({ rating: -1, createdAt: -1 })
      .limit(3);

    res.status(200).json({
      success: true,
      data: {
        provider: {
          id: service.providerId?._id,
          name: providerUser?.fullName,
          image: providerUser?.profilePicture,
          address: providerUser?.location?.address || 'Address not available',
          availableTime: service.providerId?.activityTime || ''
        },
        service: {
          serviceId: service._id,
          providerId: service.providerId?._id,
          image: service.servicePhoto,
          title: service.headline,
          about: service.description,
          whyChooseUs: service.whyChooseUs,
          appointmentEnabled: service.appointmentEnabled,
          basePrice: service.basePrice,
          appointmentSlots: service.appointmentSlots,
          topReviews: reviews.map(review => ({
            reviewId: review._id,
            rating: review.rating,
            comment: review.comment,
            createdAt: review.createdAt,
            user: {
              name: review.userId?.fullName || 'Anonymous',
              image: review.userId?.profilePicture
            }
          }))
        }
      }
    });
  } catch (error) {
    console.error('Get service detail for user error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching service details',
      error: error.message
    });
  }
};

/**
 * Get provider profile for authenticated user
 * GET /api/user/providers/:providerId/profile
 */
exports.getProviderProfileForUser = async (req, res) => {
  try {
    const { providerId } = req.params;

    const mongoose = require('mongoose');
    if (!mongoose.Types.ObjectId.isValid(providerId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid provider id'
      });
    }

    const provider = await Provider.findOne({
      _id: providerId,
      verificationStatus: 'verified',
      isAvailable: true
    }).populate({
      path: 'userId',
      select: 'fullName profilePicture location'
    });

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    const services = await Service.find({
      providerId: provider._id,
      isActive: true
    }).sort({ createdAt: -1 });

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
      .limit(20);

    const portfolioItems = await Portfolio.find({
      providerId: provider._id,
      isActive: true
    }).sort({ displayOrder: 1, createdAt: -1 });

    const now = Date.now();
    const serviceItems = services.map((service) => {
      const createdAt = service.createdAt ? new Date(service.createdAt) : null;
      const daysAgo = createdAt
        ? Math.floor((now - createdAt.getTime()) / (1000 * 60 * 60 * 24))
        : null;
      const slotPrices = (service.appointmentSlots || []).map(slot => slot.price);
      const minAppointmentPrice = slotPrices.length > 0 ? Math.min(...slotPrices) : null;

      return {
        serviceId: service._id,
        image: service.servicePhoto,
        title: service.headline,
        about: service.description,
        rating: service.rating,
        totalReviews: service.totalReviews,
        basePrice: service.basePrice,
        appointmentEnabled: service.appointmentEnabled,
        appointmentSlots: service.appointmentSlots,
        minAppointmentPrice,
        daysAgo
      };
    });

    res.status(200).json({
      success: true,
      data: {
        provider: {
          name: provider.userId?.fullName,
          image: provider.userId?.profilePicture,
          address: provider.userId?.location?.address || 'Address not available',
          rating: provider.rating,
          totalReviews: provider.totalReviews
        },
        allServices: {
          totalServices: services.length,
          services: serviceItems
        },
        reviews: reviews.map(review => ({
          reviewId: review._id,
          rating: review.rating,
          comment: review.comment,
          createdAt: review.createdAt,
          user: {
            name: review.userId?.fullName || 'Anonymous',
            image: review.userId?.profilePicture
          }
        })),
        portfolio: portfolioItems.map(item => ({
          portfolioId: item._id,
          beforeImage: item.beforeImage,
          afterImage: item.afterImage,
          about: item.about
        }))
      }
    });
  } catch (error) {
    console.error('Get provider profile for user error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching provider profile',
      error: error.message
    });
  }
};

/**
 * Get Services by Category (Public)
 * GET /api/services/category/:categoryId
 */
exports.getServicesByCategory = async (req, res) => {
  try {
    const { categoryId } = req.params;
    const { page = 1, limit = 12, sortBy = 'createdAt', order = 'desc' } = req.query;

    // Verify category exists
    const category = await Category.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const query = { category: categoryId, isActive: true };

    const sortOptions = {};
    sortOptions[sortBy] = order === 'asc' ? 1 : -1;

    const services = await Service.find(query)
      .populate('category', 'name slug icon')
      .populate({
        path: 'providerId',
        select: 'rating totalReviews',
        populate: {
          path: 'userId',
          select: 'fullName profilePicture'
        }
      })
      .sort(sortOptions)
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Service.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        category: {
          id: category._id,
          name: category.name,
          slug: category.slug,
          description: category.description
        },
        services,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page),
        total: count
      }
    });

  } catch (error) {
    console.error('Get services by category error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching services',
      error: error.message
    });
  }
};
