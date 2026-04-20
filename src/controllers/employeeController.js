const Employee = require('../models/Employee');
const EmployeeService = require('../models/EmployeeService');
const BusinessOwner = require('../models/BusinessOwner');
const Category = require('../models/Category');
const User = require('../models/User');
const Provider = require('../models/Provider');
const mongoose = require('mongoose');
const fs = require('fs').promises;
const { uploadToCloudinary } = require('../utility/cloudinary');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const removeLocalFile = async (file) => {
  if (file && file.path) {
    await fs.unlink(file.path).catch(() => {});
  }
};

/**
 * Helper function to verify business owner access
 */
const verifyBusinessOwnerAccess = async (req, employeeId = null) => {
  const businessOwner = await BusinessOwner.findOne({ userId: req.user._id });

  if (!businessOwner) {
    throw new Error('Business owner profile not found');
  }

  if (employeeId) {
    const employee = await Employee.findOne({
      _id: employeeId,
      businessOwnerId: businessOwner._id,
      isActive: true
    });

    if (!employee) {
      throw new Error('Employee not found or access denied');
    }

    return { businessOwner, employee };
  }

  return { businessOwner };
};

/**
 * Create employee with first service (atomic transaction)
 * POST /api/business-owners/employees
 */
exports.createEmployeeWithService = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      fullName,
      mobileNumber,
      email,
      headline,
      description,
      categories,
      whyChooseService,
      basePrice,
      appointmentEnabled,
      appointmentSlots
    } = req.body;
    const servicePhotoFile = req.files?.servicePhoto?.[0];
    const profilePhotoFile = req.files?.profilePhoto?.[0];

    // Validate required fields
    if (!fullName || !mobileNumber || !email) {
      await removeLocalFile(servicePhotoFile);
      await removeLocalFile(profilePhotoFile);
      return res.status(400).json({
        success: false,
        message: 'Employee full name, mobile number, and email are required'
      });
    }

    if (!headline || !description) {
      await removeLocalFile(servicePhotoFile);
      await removeLocalFile(profilePhotoFile);
      return res.status(400).json({
        success: false,
        message: 'Service headline and description are required'
      });
    }

    // Validate service photo uploaded
    if (!servicePhotoFile) {
      return res.status(400).json({
        success: false,
        message: 'Service photo is required'
      });
    }

    // Parse categories
    let parsedCategories;
    try {
      parsedCategories = JSON.parse(categories);
    } catch (error) {
      await removeLocalFile(servicePhotoFile);
      await removeLocalFile(profilePhotoFile);
      return res.status(400).json({
        success: false,
        message: 'Invalid categories format'
      });
    }

    if (!parsedCategories || parsedCategories.length === 0) {
      await removeLocalFile(servicePhotoFile);
      await removeLocalFile(profilePhotoFile);
      return res.status(400).json({
        success: false,
        message: 'At least one category is required'
      });
    }

    // Validate categories exist
    const existingCategories = await Category.find({
      _id: { $in: parsedCategories },
      isActive: true
    });

    if (existingCategories.length !== parsedCategories.length) {
      await removeLocalFile(servicePhotoFile);
      await removeLocalFile(profilePhotoFile);
      return res.status(400).json({
        success: false,
        message: 'One or more invalid categories'
      });
    }

    // Parse why choose service
    let parsedWhyChoose = {
      reason1: '',
      reason2: '',
      reason3: '',
      reason4: ''
    };
    if (whyChooseService) {
      try {
        parsedWhyChoose = JSON.parse(whyChooseService);
      } catch (error) {
        // Use default if parsing fails
      }
    }

    // Validate pricing
    const isAppointmentEnabled = appointmentEnabled === 'true' || appointmentEnabled === true;

    if (isAppointmentEnabled) {
      let parsedSlots;
      try {
        parsedSlots = JSON.parse(appointmentSlots);
      } catch (error) {
        await removeLocalFile(servicePhotoFile);
        await removeLocalFile(profilePhotoFile);
        return res.status(400).json({
          success: false,
          message: 'Invalid appointment slots format'
        });
      }

      if (!parsedSlots || parsedSlots.length === 0) {
        await removeLocalFile(servicePhotoFile);
        await removeLocalFile(profilePhotoFile);
        return res.status(400).json({
          success: false,
          message: 'At least one appointment slot is required when appointment is enabled'
        });
      }
    } else {
      if (!basePrice || parseFloat(basePrice) <= 0) {
        await removeLocalFile(servicePhotoFile);
        await removeLocalFile(profilePhotoFile);
        return res.status(400).json({
          success: false,
          message: 'Base price is required when appointment is disabled'
        });
      }
    }

    // Get business owner
    const { businessOwner } = await verifyBusinessOwnerAccess(req);

    // Upload service photo to Cloudinary
    const uploadResult = await uploadToCloudinary(servicePhotoFile.path, 'employee-services');

    if (!uploadResult.success) {
      await removeLocalFile(servicePhotoFile);
      await removeLocalFile(profilePhotoFile);
      return res.status(500).json({
        success: false,
        message: 'Failed to upload service photo'
      });
    }

    let profilePhotoUrl = null;
    if (profilePhotoFile) {
      const profileUploadResult = await uploadToCloudinary(profilePhotoFile.path, 'employee-profiles');
      if (!profileUploadResult.success) {
        await removeLocalFile(servicePhotoFile);
        await removeLocalFile(profilePhotoFile);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload profile photo'
        });
      }
      profilePhotoUrl = profileUploadResult.url;
    }

    // Create Employee
    const employee = new Employee({
      businessOwnerId: businessOwner._id,
      fullName,
      mobileNumber,
      email,
      profilePhoto: profilePhotoUrl || undefined,
      isActive: true
    });

    await employee.save({ session });

    // Create EmployeeService
    const serviceData = {
      employeeId: employee._id,
      businessOwnerId: businessOwner._id,
      servicePhoto: uploadResult.url,
      categories: parsedCategories,
      headline,
      description,
      whyChooseService: parsedWhyChoose,
      appointmentEnabled: isAppointmentEnabled,
      isActive: true
    };

    if (isAppointmentEnabled) {
      serviceData.appointmentSlots = JSON.parse(appointmentSlots);
      serviceData.basePrice = 0;
    } else {
      serviceData.basePrice = parseFloat(basePrice);
      serviceData.appointmentSlots = [];
    }

    const employeeService = new EmployeeService(serviceData);
    await employeeService.save({ session });

    // Commit transaction
    await session.commitTransaction();

    // Cleanup local file
    await removeLocalFile(servicePhotoFile);
    await removeLocalFile(profilePhotoFile);

    res.status(201).json({
      success: true,
      message: 'Employee and service created successfully',
      data: {
        employee,
        service: employeeService,
        employeeServiceId: employeeService._id
      }
    });

  } catch (error) {
    await session.abortTransaction();

    // Cleanup uploaded file
    const servicePhotoFile = req.files?.servicePhoto?.[0];
    const profilePhotoFile = req.files?.profilePhoto?.[0];
    await removeLocalFile(servicePhotoFile);
    await removeLocalFile(profilePhotoFile);

    console.error('Create employee error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while creating employee',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    session.endSession();
  }
};

/**
 * Create employee only (without creating service/appointment)
 * POST /api/business-owners/employees/basic
 */
exports.createEmployeeOnly = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { fullName, mobileNumber, email, password } = req.body;
    const profilePhotoFile = req.files?.profilePhoto?.[0] || null;
    const servicePhotoFile = req.files?.servicePhoto?.[0] || null;

    if (!fullName || !mobileNumber || !email || !password) {
      await session.abortTransaction();
      await removeLocalFile(profilePhotoFile);
      await removeLocalFile(servicePhotoFile);
      return res.status(400).json({
        success: false,
        message: 'Employee full name, mobile number, email, and password are required'
      });
    }

    if (password.length < 6) {
      await session.abortTransaction();
      await removeLocalFile(profilePhotoFile);
      await removeLocalFile(servicePhotoFile);
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = mobileNumber.trim();

    const { businessOwner } = await verifyBusinessOwnerAccess(req);

    const existingUser = await User.findOne({
      $or: [{ email: normalizedEmail }, { phoneNumber: normalizedPhone }]
    }).session(session);

    if (existingUser) {
      await session.abortTransaction();
      await removeLocalFile(profilePhotoFile);
      await removeLocalFile(servicePhotoFile);
      return res.status(400).json({
        success: false,
        message: 'User with this email or phone number already exists'
      });
    }

    let profilePhotoUrl = null;
    if (profilePhotoFile) {
      const profileUploadResult = await uploadToCloudinary(
        profilePhotoFile.path,
        'employee-profiles'
      );

      if (!profileUploadResult.success) {
        await session.abortTransaction();
        await removeLocalFile(profilePhotoFile);
        await removeLocalFile(servicePhotoFile);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload profile photo'
        });
      }

      profilePhotoUrl = profileUploadResult.url;
    }

    const user = new User({
      fullName: fullName.trim(),
      email: normalizedEmail,
      phoneNumber: normalizedPhone,
      password,
      userType: 'provider',
      authProvider: 'local',
      termsAccepted: true,
      businessOwnerId: businessOwner._id
    });

    await user.save({ session });

    const provider = new Provider({
      userId: user._id,
      businessOwnerId: businessOwner._id,
      verificationStatus: 'verified'
    });

    await provider.save({ session });

    const employee = new Employee({
      businessOwnerId: businessOwner._id,
      userId: user._id,
      fullName: fullName.trim(),
      mobileNumber: normalizedPhone,
      email: normalizedEmail,
      profilePhoto: profilePhotoUrl || undefined,
      isActive: true
    });

    await employee.save({ session });

    await session.commitTransaction();

    await removeLocalFile(profilePhotoFile);
    await removeLocalFile(servicePhotoFile);

    return res.status(201).json({
      success: true,
      message: 'Employee account created successfully',
      data: {
        employee,
        provider: {
          id: provider._id,
          userId: user._id,
          businessOwnerId: businessOwner._id
        }
      }
    });
  } catch (error) {
    await session.abortTransaction();

    const profilePhotoFile = req.files?.profilePhoto?.[0] || null;
    const servicePhotoFile = req.files?.servicePhoto?.[0] || null;
    await removeLocalFile(profilePhotoFile);
    await removeLocalFile(servicePhotoFile);

    console.error('Create employee only error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while creating employee',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  } finally {
    session.endSession();
  }
};

/**
 * List all employees for business owner
 * GET /api/business-owners/employees
 */
exports.listEmployees = async (req, res) => {
  try {
    const { businessOwner } = await verifyBusinessOwnerAccess(req);

    // Get employees with service count
    const employees = await Employee.aggregate([
      {
        $match: {
          businessOwnerId: businessOwner._id,
          isActive: true
        }
      },
      {
        $lookup: {
          from: 'employeeservices',
          localField: '_id',
          foreignField: 'employeeId',
          as: 'services'
        }
      },
      {
        $addFields: {
          serviceCount: {
            $size: {
              $filter: {
                input: '$services',
                as: 'service',
                cond: { $eq: ['$$service.isActive', true] }
              }
            }
          },
          employeeServiceId: {
            $let: {
              vars: {
                activeServices: {
                  $filter: {
                    input: '$services',
                    as: 'service',
                    cond: { $eq: ['$$service.isActive', true] }
                  }
                }
              },
              in: {
                $ifNull: [{ $arrayElemAt: ['$$activeServices._id', 0] }, null]
              }
            }
          }
        }
      },
      {
        $project: {
          fullName: 1,
          mobileNumber: 1,
          email: 1,
          isActive: 1,
          serviceCount: 1,
          employeeServiceId: 1,
          createdAt: 1,
          updatedAt: 1
        }
      },
      {
        $sort: { createdAt: -1 }
      }
    ]);

    res.status(200).json({
      success: true,
      count: employees.length,
      data: employees
    });

  } catch (error) {
    console.error('List employees error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while fetching employees'
    });
  }
};

/**
 * Search employees for business owner
 * GET /api/business-owners/employees/search
 */
exports.searchEmployees = async (req, res) => {
  try {
    const { q, page = 1, limit = 20 } = req.query;

    if (!q || !q.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Please provide a search query'
      });
    }

    const { businessOwner } = await verifyBusinessOwnerAccess(req);
    const escapedQuery = escapeRegExp(q.trim());
    const regex = new RegExp(escapedQuery, 'i');
    const skip = (page - 1) * limit;

    const query = {
      businessOwnerId: businessOwner._id,
      isActive: true,
      $or: [
        { fullName: regex },
        { email: regex },
        { mobileNumber: regex }
      ]
    };

    const [employees, total] = await Promise.all([
      Employee.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10)),
      Employee.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      count: employees.length,
      total,
      currentPage: parseInt(page, 10),
      totalPages: Math.ceil(total / limit),
      data: employees
    });
  } catch (error) {
    console.error('Search employees error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while searching employees'
    });
  }
};

/**
 * Get employee detail with all services
 * GET /api/business-owners/employees/:id
 */
exports.getEmployeeDetail = async (req, res) => {
  try {
    const { id } = req.params;

    const { employee } = await verifyBusinessOwnerAccess(req, id);

    // Get all services for this employee
    const services = await EmployeeService.find({
      employeeId: id,
      isActive: true
    }).populate('categories', 'name');

    const servicesWithIds = services.map((service) => ({
      ...service.toObject(),
      employeeServiceId: service._id
    }));

    res.status(200).json({
      success: true,
      data: {
        employee,
        services: servicesWithIds
      }
    });

  } catch (error) {
    console.error('Get employee detail error:', error);
    res.status(error.message === 'Employee not found or access denied' ? 404 : 500).json({
      success: false,
      message: error.message || 'An error occurred while fetching employee details'
    });
  }
};

/**
 * Get employee phone number
 * GET /api/business-owners/employees/:id/phone
 */
exports.getEmployeePhoneNumber = async (req, res) => {
  try {
    const { id } = req.params;
    const { employee } = await verifyBusinessOwnerAccess(req, id);

    res.status(200).json({
      success: true,
      data: {
        employeeId: employee._id,
        phoneNumber: employee.mobileNumber
      }
    });
  } catch (error) {
    console.error('Get employee phone number error:', error);
    res.status(error.message === 'Employee not found or access denied' ? 404 : 500).json({
      success: false,
      message: error.message || 'An error occurred while fetching employee phone number'
    });
  }
};

/**
 * Get employee overview, activities, and orders
 * GET /api/business-owners/employees/:id/overview
 */
exports.getEmployeeOverview = async (req, res) => {
  try {
    const { id } = req.params;
    const upcomingLimit = Math.min(parseInt(req.query.upcomingLimit || '10', 10), 50);
    const ordersLimit = Math.min(parseInt(req.query.ordersLimit || '20', 10), 100);

    const { employee } = await verifyBusinessOwnerAccess(req, id);

    const BusinessOwnerBooking = require('../models/BusinessOwnerBooking');
    const BusinessOwnerAppointment = require('../models/BusinessOwnerAppointment');
    const User = require('../models/User');

    const services = await EmployeeService.find({
      employeeId: id,
      businessOwnerId: employee.businessOwnerId,
      isActive: true
    }).select('rating totalReviews');

    const serviceIds = services.map(service => service._id);

    const totalReviews = services.reduce((sum, service) => sum + (service.totalReviews || 0), 0);
    const weightedRating = totalReviews > 0
      ? services.reduce((sum, service) => sum + ((service.rating || 0) * (service.totalReviews || 0)), 0) / totalReviews
      : (services.length > 0
        ? services.reduce((sum, service) => sum + (service.rating || 0), 0) / services.length
        : 0);

    const [
      completedBookingCount,
      completedAppointmentCount,
      bookingIncomeAgg,
      appointmentIncomeAgg
    ] = await Promise.all([
      BusinessOwnerBooking.countDocuments({
        employeeServiceId: { $in: serviceIds },
        bookingStatus: 'completed'
      }),
      BusinessOwnerAppointment.countDocuments({
        employeeServiceId: { $in: serviceIds },
        appointmentStatus: 'completed'
      }),
      BusinessOwnerBooking.aggregate([
        { $match: { employeeServiceId: { $in: serviceIds }, paymentStatus: 'completed' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ]),
      BusinessOwnerAppointment.aggregate([
        { $match: { employeeServiceId: { $in: serviceIds }, paymentStatus: 'completed' } },
        { $group: { _id: null, total: { $sum: '$totalAmount' } } }
      ])
    ]);

    const bookingIncome = bookingIncomeAgg[0]?.total || 0;
    const appointmentIncome = appointmentIncomeAgg[0]?.total || 0;
    const totalJobsCompleted = completedBookingCount + completedAppointmentCount;
    const totalEarnings = bookingIncome + appointmentIncome;

    const now = new Date();
    const activeBookingStatuses = ['pending', 'confirmed', 'in_progress'];
    const activeAppointmentStatuses = ['pending', 'confirmed', 'in_progress'];

    const [upcomingBookings, upcomingAppointments] = await Promise.all([
      BusinessOwnerBooking.find({
        employeeServiceId: { $in: serviceIds },
        bookingDate: { $gte: now },
        bookingStatus: { $in: activeBookingStatuses }
      })
        .populate('userId', 'fullName')
        .sort({ bookingDate: 1 })
        .limit(upcomingLimit)
        .select('userId bookingDate bookingStatus serviceSnapshot'),
      BusinessOwnerAppointment.find({
        employeeServiceId: { $in: serviceIds },
        appointmentDate: { $gte: now },
        appointmentStatus: { $in: activeAppointmentStatuses }
      })
        .populate('userId', 'fullName')
        .sort({ appointmentDate: 1 })
        .limit(upcomingLimit)
        .select('userId appointmentDate appointmentStatus timeSlot serviceSnapshot')
    ]);

    const upcomingSchedules = [
      ...upcomingBookings.map(booking => ({
        type: 'booking',
        userName: booking.userId?.fullName || 'Unknown',
        date: booking.bookingDate,
        time: null,
        status: booking.bookingStatus,
        title: booking.serviceSnapshot?.serviceName || 'Service'
      })),
      ...upcomingAppointments.map(appointment => ({
        type: 'appointment',
        userName: appointment.userId?.fullName || 'Unknown',
        date: appointment.appointmentDate,
        time: appointment.timeSlot ? {
          start: appointment.timeSlot.startTime,
          end: appointment.timeSlot.endTime
        } : null,
        status: appointment.appointmentStatus,
        title: appointment.serviceSnapshot?.serviceName || appointment.serviceSnapshot?.headline || 'Service'
      }))
    ].sort((a, b) => new Date(a.date) - new Date(b.date))
      .slice(0, upcomingLimit);

    const [recentBookings, recentAppointments] = await Promise.all([
      BusinessOwnerBooking.find({
        employeeServiceId: { $in: serviceIds }
      })
        .populate('userId', 'fullName')
        .sort({ createdAt: -1 })
        .limit(ordersLimit)
        .select('userId bookingStatus totalAmount createdAt serviceSnapshot'),
      BusinessOwnerAppointment.find({
        employeeServiceId: { $in: serviceIds }
      })
        .populate('userId', 'fullName')
        .sort({ createdAt: -1 })
        .limit(ordersLimit)
        .select('userId appointmentStatus totalAmount createdAt serviceSnapshot')
    ]);

    const orders = [
      ...recentBookings.map(booking => ({
        type: 'booking',
        orderId: booking._id,
        userName: booking.userId?.fullName || 'Unknown',
        title: booking.serviceSnapshot?.serviceName || 'Service',
        status: booking.bookingStatus,
        price: booking.totalAmount,
        createdAt: booking.createdAt
      })),
      ...recentAppointments.map(appointment => ({
        type: 'appointment',
        orderId: appointment._id,
        userName: appointment.userId?.fullName || 'Unknown',
        title: appointment.serviceSnapshot?.serviceName || appointment.serviceSnapshot?.headline || 'Service',
        status: appointment.appointmentStatus,
        price: appointment.totalAmount,
        createdAt: appointment.createdAt
      }))
    ].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, ordersLimit);

    const activities = orders.slice(0, 10).map(order => ({
      type: order.type,
      title: order.title,
      status: order.status,
      date: order.createdAt
    }));

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalJobsCompleted,
          rating: Math.round(weightedRating * 10) / 10,
          totalEarnings,
          joinedDate: employee.createdAt,
          upcomingSchedules,
          contractInformation: {
            phoneNumber: employee.mobileNumber,
            emailAddress: employee.email
          }
        },
        activities,
        orders
      }
    });
  } catch (error) {
    console.error('Get employee overview error:', error);
    res.status(error.message === 'Employee not found or access denied' ? 404 : 500).json({
      success: false,
      message: error.message || 'An error occurred while fetching employee overview'
    });
  }
};

/**
 * Update employee information
 * PUT /api/business-owners/employees/:id
 */
exports.updateEmployee = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      fullName,
      mobileNumber,
      email,
      employeeServiceId,
      headline,
      description,
      categories,
      whyChooseService,
      basePrice,
      appointmentEnabled,
      appointmentSlots
    } = req.body;
    const servicePhotoFile = req.files?.servicePhoto?.[0];
    const profilePhotoFile = req.files?.profilePhoto?.[0];

    const { employee } = await verifyBusinessOwnerAccess(req, id);

    // Update fields if provided
    if (fullName) employee.fullName = fullName;
    if (mobileNumber) employee.mobileNumber = mobileNumber;
    if (email) employee.email = email;

    if (profilePhotoFile) {
      const profileUploadResult = await uploadToCloudinary(profilePhotoFile.path, 'employee-profiles');
      if (!profileUploadResult.success) {
        await removeLocalFile(profilePhotoFile);
        return res.status(500).json({
          success: false,
          message: 'Failed to upload profile photo'
        });
      }
      employee.profilePhoto = profileUploadResult.url;
      await removeLocalFile(profilePhotoFile);
    }

    await employee.save();

    let updatedService = null;
    if (
      employeeServiceId ||
      servicePhotoFile ||
      headline ||
      description ||
      categories ||
      whyChooseService ||
      basePrice !== undefined ||
      appointmentEnabled !== undefined ||
      appointmentSlots
    ) {
      if (!employeeServiceId) {
        await removeLocalFile(servicePhotoFile);
        return res.status(400).json({
          success: false,
          message: 'employeeServiceId is required to update service details'
        });
      }

      const service = await EmployeeService.findOne({
        _id: employeeServiceId,
        employeeId: employee._id,
        isActive: true
      });

      if (!service) {
        await removeLocalFile(servicePhotoFile);
        return res.status(404).json({
          success: false,
          message: 'Employee service not found'
        });
      }

      if (servicePhotoFile) {
        const uploadResult = await uploadToCloudinary(servicePhotoFile.path, 'employee-services');

        if (!uploadResult.success) {
          await removeLocalFile(servicePhotoFile);
          return res.status(500).json({
            success: false,
            message: 'Failed to upload service photo'
          });
        }

        service.servicePhoto = uploadResult.url;
        await removeLocalFile(servicePhotoFile);
      }

      if (headline) service.headline = headline;
      if (description) service.description = description;

      if (categories) {
        let parsedCategories;
        try {
          parsedCategories = Array.isArray(categories) ? categories : JSON.parse(categories);
        } catch (error) {
          await removeLocalFile(servicePhotoFile);
          return res.status(400).json({
            success: false,
            message: 'Invalid categories format'
          });
        }

        const existingCategories = await Category.find({
          _id: { $in: parsedCategories },
          isActive: true
        });

        if (existingCategories.length !== parsedCategories.length) {
          await removeLocalFile(servicePhotoFile);
          return res.status(400).json({
            success: false,
            message: 'One or more invalid categories'
          });
        }

        service.categories = parsedCategories;
      }

      if (whyChooseService) {
        try {
          service.whyChooseService = typeof whyChooseService === 'string'
            ? JSON.parse(whyChooseService)
            : whyChooseService;
        } catch (error) {
          await removeLocalFile(servicePhotoFile);
          return res.status(400).json({
            success: false,
            message: 'Invalid whyChooseService format'
          });
        }
      }

      if (appointmentEnabled !== undefined) {
        const isAppointmentEnabled = appointmentEnabled === 'true' || appointmentEnabled === true;
        service.appointmentEnabled = isAppointmentEnabled;

        if (isAppointmentEnabled) {
          if (!appointmentSlots) {
            await removeLocalFile(servicePhotoFile);
            return res.status(400).json({
              success: false,
              message: 'appointmentSlots is required when appointmentEnabled is true'
            });
          }

          try {
            service.appointmentSlots = Array.isArray(appointmentSlots)
              ? appointmentSlots
              : JSON.parse(appointmentSlots);
          } catch (error) {
            await removeLocalFile(servicePhotoFile);
            return res.status(400).json({
              success: false,
              message: 'Invalid appointmentSlots format'
            });
          }
          service.basePrice = 0;
        } else if (basePrice !== undefined) {
          service.basePrice = parseFloat(basePrice);
          service.appointmentSlots = [];
        }
      } else if (basePrice !== undefined && service.appointmentEnabled === false) {
        service.basePrice = parseFloat(basePrice);
      }

      updatedService = await service.save();
    }

    res.status(200).json({
      success: true,
      message: 'Employee updated successfully',
      data: {
        employee,
        service: updatedService
      }
    });

  } catch (error) {
    const servicePhotoFile = req.files?.servicePhoto?.[0];
    const profilePhotoFile = req.files?.profilePhoto?.[0];
    await removeLocalFile(servicePhotoFile);
    await removeLocalFile(profilePhotoFile);
    console.error('Update employee error:', error);
    res.status(error.message === 'Employee not found or access denied' ? 404 : 500).json({
      success: false,
      message: error.message || 'An error occurred while updating employee'
    });
  }
};

/**
 * Toggle employee active status (block/unblock)
 * PATCH /api/business-owners/employees/:id/toggle-status
 */
exports.toggleEmployeeStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body;

    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id });
    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    const employee = await Employee.findOne({
      _id: id,
      businessOwnerId: businessOwner._id
    });

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found or access denied'
      });
    }

    const nextStatus =
      isActive === undefined ? !employee.isActive : (isActive === 'true' || isActive === true);
    employee.isActive = nextStatus;
    await employee.save();

    res.status(200).json({
      success: true,
      message: `Employee ${employee.isActive ? 'unblocked' : 'blocked'} successfully`,
      data: {
        employeeId: employee._id,
        isActive: employee.isActive
      }
    });
  } catch (error) {
    console.error('Toggle employee status error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while updating employee status'
    });
  }
};

/**
 * Delete employee (cascade soft delete all services)
 * DELETE /api/business-owners/employees/:id
 */
exports.deleteEmployee = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { id } = req.params;

    const { employee } = await verifyBusinessOwnerAccess(req, id);

    // Soft delete employee
    employee.isActive = false;
    await employee.save({ session });

    // Cascade soft delete all services
    await EmployeeService.updateMany(
      { employeeId: id },
      { $set: { isActive: false } },
      { session }
    );

    await session.commitTransaction();

    res.status(200).json({
      success: true,
      message: 'Employee and associated services deleted successfully'
    });

  } catch (error) {
    await session.abortTransaction();

    console.error('Delete employee error:', error);
    res.status(error.message === 'Employee not found or access denied' ? 404 : 500).json({
      success: false,
      message: error.message || 'An error occurred while deleting employee'
    });
  } finally {
    session.endSession();
  }
};

/**
 * Add service to existing employee
 * POST /api/business-owners/employees/:employeeId/services
 */
exports.addService = async (req, res) => {
  try {
    const { employeeId } = req.params;
    const {
      headline,
      description,
      categories,
      whyChooseService,
      basePrice,
      appointmentEnabled,
      appointmentSlots
    } = req.body;

    // Validate required fields
    if (!headline || !description) {
      return res.status(400).json({
        success: false,
        message: 'Service headline and description are required'
      });
    }

    // Validate service photo uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Service photo is required'
      });
    }

    // Verify employee access
    const { employee, businessOwner } = await verifyBusinessOwnerAccess(req, employeeId);

    // Parse and validate categories
    let parsedCategories;
    try {
      parsedCategories = JSON.parse(categories);
    } catch (error) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({
        success: false,
        message: 'Invalid categories format'
      });
    }

    const existingCategories = await Category.find({
      _id: { $in: parsedCategories },
      isActive: true
    });

    if (existingCategories.length !== parsedCategories.length) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(400).json({
        success: false,
        message: 'One or more invalid categories'
      });
    }

    // Parse why choose service
    let parsedWhyChoose = {
      reason1: '',
      reason2: '',
      reason3: '',
      reason4: ''
    };
    if (whyChooseService) {
      try {
        parsedWhyChoose = JSON.parse(whyChooseService);
      } catch (error) {
        // Use default
      }
    }

    // Validate pricing
    const isAppointmentEnabled = appointmentEnabled === 'true' || appointmentEnabled === true;

    if (isAppointmentEnabled) {
      let parsedSlots;
      try {
        parsedSlots = JSON.parse(appointmentSlots);
      } catch (error) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({
          success: false,
          message: 'Invalid appointment slots format'
        });
      }

      if (!parsedSlots || parsedSlots.length === 0) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({
          success: false,
          message: 'At least one appointment slot is required'
        });
      }
    } else {
      if (!basePrice || parseFloat(basePrice) <= 0) {
        await fs.unlink(req.file.path).catch(() => {});
        return res.status(400).json({
          success: false,
          message: 'Base price is required when appointment is disabled'
        });
      }
    }

    // Upload service photo
    const uploadResult = await uploadToCloudinary(req.file.path, 'employee-services');

    if (!uploadResult.success) {
      await fs.unlink(req.file.path).catch(() => {});
      return res.status(500).json({
        success: false,
        message: 'Failed to upload service photo'
      });
    }

    // Create service
    const serviceData = {
      employeeId: employee._id,
      businessOwnerId: businessOwner._id,
      servicePhoto: uploadResult.url,
      categories: parsedCategories,
      headline,
      description,
      whyChooseService: parsedWhyChoose,
      appointmentEnabled: isAppointmentEnabled,
      isActive: true
    };

    if (isAppointmentEnabled) {
      serviceData.appointmentSlots = JSON.parse(appointmentSlots);
      serviceData.basePrice = 0;
    } else {
      serviceData.basePrice = parseFloat(basePrice);
      serviceData.appointmentSlots = [];
    }

    const employeeService = new EmployeeService(serviceData);
    await employeeService.save();

    // Cleanup local file
    await fs.unlink(req.file.path).catch(() => {});

    res.status(201).json({
      success: true,
      message: 'Service added successfully',
      data: employeeService
    });

  } catch (error) {
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    console.error('Add service error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while adding service'
    });
  }
};

/**
 * Get all services for an employee
 * GET /api/business-owners/employees/:employeeId/services
 */
exports.getEmployeeServices = async (req, res) => {
  try {
    const { employeeId } = req.params;

    await verifyBusinessOwnerAccess(req, employeeId);

    const services = await EmployeeService.find({
      employeeId,
      isActive: true
    }).populate('categories', 'name');

    res.status(200).json({
      success: true,
      count: services.length,
      data: services
    });

  } catch (error) {
    console.error('Get employee services error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while fetching services'
    });
  }
};

/**
 * Update employee service
 * PUT /api/business-owners/employees/:employeeId/services/:id
 */
exports.updateService = async (req, res) => {
  try {
    const { employeeId, id } = req.params;
    const {
      headline,
      description,
      categories,
      whyChooseService,
      basePrice,
      appointmentEnabled,
      appointmentSlots
    } = req.body;

    await verifyBusinessOwnerAccess(req, employeeId);

    const service = await EmployeeService.findOne({
      _id: id,
      employeeId,
      isActive: true
    });

    if (!service) {
      if (req.file) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    // Update photo if provided
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file.path, 'employee-services');

      if (uploadResult.success) {
        service.servicePhoto = uploadResult.url;
      }

      await fs.unlink(req.file.path).catch(() => {});
    }

    // Update fields if provided
    if (headline) service.headline = headline;
    if (description) service.description = description;

    if (categories) {
      try {
        const parsedCategories = JSON.parse(categories);
        const existingCategories = await Category.find({
          _id: { $in: parsedCategories },
          isActive: true
        });

        if (existingCategories.length === parsedCategories.length) {
          service.categories = parsedCategories;
        }
      } catch (error) {
        // Keep existing categories
      }
    }

    if (whyChooseService) {
      try {
        service.whyChooseService = JSON.parse(whyChooseService);
      } catch (error) {
        // Keep existing
      }
    }

    // Update pricing
    if (appointmentEnabled !== undefined) {
      const isAppointmentEnabled = appointmentEnabled === 'true' || appointmentEnabled === true;
      service.appointmentEnabled = isAppointmentEnabled;

      if (isAppointmentEnabled && appointmentSlots) {
        try {
          service.appointmentSlots = JSON.parse(appointmentSlots);
          service.basePrice = 0;
        } catch (error) {
          // Keep existing
        }
      } else if (!isAppointmentEnabled && basePrice) {
        service.basePrice = parseFloat(basePrice);
        service.appointmentSlots = [];
      }
    }

    await service.save();

    res.status(200).json({
      success: true,
      message: 'Service updated successfully',
      data: service
    });

  } catch (error) {
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    console.error('Update service error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while updating service'
    });
  }
};

/**
 * Delete employee service
 * DELETE /api/business-owners/employees/:employeeId/services/:id
 */
exports.deleteService = async (req, res) => {
  try {
    const { employeeId, id } = req.params;

    await verifyBusinessOwnerAccess(req, employeeId);

    const service = await EmployeeService.findOne({
      _id: id,
      employeeId,
      isActive: true
    });

    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    service.isActive = false;
    await service.save();

    res.status(200).json({
      success: true,
      message: 'Service deleted successfully'
    });

  } catch (error) {
    console.error('Delete service error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while deleting service'
    });
  }
};

/**
 * Create service with optional employee ID
 * POST /api/business-owners/services
 * Can create service with or without assigning to an employee
 */
exports.createServiceWithOptionalEmployee = async (req, res) => {
  try {
    const {
      employeeId,
      headline,
      description,
      categories,
      whyChooseService,
      basePrice,
      appointmentEnabled,
      appointmentSlots
    } = req.body;

    // Validate required fields
    if (!headline || !description) {
      return res.status(400).json({
        success: false,
        message: 'Service headline and description are required'
      });
    }

    // Validate service photo uploaded
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Service photo is required'
      });
    }

    // Get business owner
    const businessOwner = await BusinessOwner.findOne({ userId: req.user._id });

    if (!businessOwner) {
      await removeLocalFile(req.file);
      return res.status(403).json({
        success: false,
        message: 'Business owner profile not found'
      });
    }

    // Validate employee if provided
    let employee = null;
    if (employeeId) {
      employee = await Employee.findOne({
        _id: employeeId,
        businessOwnerId: businessOwner._id,
        isActive: true
      });

      if (!employee) {
        await removeLocalFile(req.file);
        return res.status(404).json({
          success: false,
          message: 'Employee not found or access denied'
        });
      }
    }

    // Parse and validate categories
    let parsedCategories;
    try {
      parsedCategories = JSON.parse(categories);
    } catch (error) {
      await removeLocalFile(req.file);
      return res.status(400).json({
        success: false,
        message: 'Invalid categories format'
      });
    }

    if (!parsedCategories || parsedCategories.length === 0) {
      await removeLocalFile(req.file);
      return res.status(400).json({
        success: false,
        message: 'At least one category is required'
      });
    }

    const existingCategories = await Category.find({
      _id: { $in: parsedCategories },
      isActive: true
    });

    if (existingCategories.length !== parsedCategories.length) {
      await removeLocalFile(req.file);
      return res.status(400).json({
        success: false,
        message: 'One or more invalid categories'
      });
    }

    // Parse why choose service
    let parsedWhyChoose = {
      reason1: '',
      reason2: '',
      reason3: '',
      reason4: ''
    };
    if (whyChooseService) {
      try {
        parsedWhyChoose = JSON.parse(whyChooseService);
      } catch (error) {
        // Use default
      }
    }

    // Validate pricing
    const isAppointmentEnabled = appointmentEnabled === 'true' || appointmentEnabled === true;

    if (isAppointmentEnabled) {
      let parsedSlots;
      try {
        parsedSlots = JSON.parse(appointmentSlots);
      } catch (error) {
        await removeLocalFile(req.file);
        return res.status(400).json({
          success: false,
          message: 'Invalid appointment slots format'
        });
      }

      if (!parsedSlots || parsedSlots.length === 0) {
        await removeLocalFile(req.file);
        return res.status(400).json({
          success: false,
          message: 'At least one appointment slot is required'
        });
      }
    } else {
      if (!basePrice || parseFloat(basePrice) <= 0) {
        await removeLocalFile(req.file);
        return res.status(400).json({
          success: false,
          message: 'Base price is required when appointment is disabled'
        });
      }
    }

    // Upload service photo
    const uploadResult = await uploadToCloudinary(req.file.path, 'employee-services');

    if (!uploadResult.success) {
      await removeLocalFile(req.file);
      return res.status(500).json({
        success: false,
        message: 'Failed to upload service photo'
      });
    }

    // Create service
    const serviceData = {
      businessOwnerId: businessOwner._id,
      servicePhoto: uploadResult.url,
      categories: parsedCategories,
      headline,
      description,
      whyChooseService: parsedWhyChoose,
      appointmentEnabled: isAppointmentEnabled,
      isActive: true
    };

    // Add employee ID if provided
    if (employee) {
      serviceData.employeeId = employee._id;
    }

    if (isAppointmentEnabled) {
      serviceData.appointmentSlots = JSON.parse(appointmentSlots);
      serviceData.basePrice = 0;
    } else {
      serviceData.basePrice = parseFloat(basePrice);
      serviceData.appointmentSlots = [];
    }

    const employeeService = new EmployeeService(serviceData);
    await employeeService.save();

    // Cleanup local file
    await removeLocalFile(req.file);

    res.status(201).json({
      success: true,
      message: 'Service created successfully',
      data: employeeService
    });

  } catch (error) {
    if (req.file) {
      await removeLocalFile(req.file);
    }

    console.error('Create service error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'An error occurred while creating service'
    });
  }
};
