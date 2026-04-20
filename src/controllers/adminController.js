const Admin = require('../models/Admin');
const User = require('../models/User');
const Provider = require('../models/Provider');
const Review = require('../models/Review');
const BusinessOwner = require('../models/BusinessOwner');
const EventManager = require('../models/EventManager');
const Settings = require('../models/Settings');
const Employee = require('../models/Employee');
const EmployeeService = require('../models/EmployeeService');
const Event = require('../models/Event');
const EventTicketPurchase = require('../models/EventTicketPurchase');
const Booking = require('../models/Booking');
const Appointment = require('../models/Appointment');
const BusinessOwnerBooking = require('../models/BusinessOwnerBooking');
const BusinessOwnerAppointment = require('../models/BusinessOwnerAppointment');
const PaymentRefundLog = require('../models/PaymentRefundLog');
const AdminRefreshToken = require('../models/AdminRefreshToken');
const Notification = require('../models/Notification');
const DeviceToken = require('../models/DeviceToken');
const { generateAccessToken, generateRefreshToken, getTokenExpiresIn, verifyRefreshToken } = require('../utility/jwt');
const { deleteFromCloudinary } = require('../utility/cloudinary');
const { getStripe } = require('../utility/stripe');
const firebaseAdmin = require('../config/firebase');
const crypto = require('crypto');
const mongoose = require('mongoose');

// Simple HTML sanitizer function to prevent XSS
// For production, consider using a library like 'sanitize-html' or 'DOMPurify'
const sanitizeHtml = (html) => {
  if (!html) return '';

  // Remove script tags and their content
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');

  // Remove event handlers
  clean = clean.replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '');
  clean = clean.replace(/\s*on\w+\s*=\s*[^\s>]+/gi, '');

  // Remove javascript: URLs
  clean = clean.replace(/javascript\s*:/gi, '');

  return clean;
};

const MAX_DISCOVERY_PIN_ITEMS = 100;
const BROADCAST_USER_TYPES = ['user', 'provider', 'businessOwner', 'eventManager'];
const PUSH_BATCH_SIZE = 500;
const STRIPE_REFUND_REASONS = ['duplicate', 'fraudulent', 'requested_by_customer'];

const REFUND_SOURCE_LOOKUP = [
  { model: Booking, sourceModel: 'Booking', sourcePaymentField: 'paymentIntentId' },
  { model: Booking, sourceModel: 'Booking', sourcePaymentField: 'duePaymentIntentId' },
  { model: BusinessOwnerBooking, sourceModel: 'BusinessOwnerBooking', sourcePaymentField: 'paymentIntentId' },
  { model: BusinessOwnerBooking, sourceModel: 'BusinessOwnerBooking', sourcePaymentField: 'duePaymentIntentId' },
  { model: Appointment, sourceModel: 'Appointment', sourcePaymentField: 'paymentIntentId' },
  { model: BusinessOwnerAppointment, sourceModel: 'BusinessOwnerAppointment', sourcePaymentField: 'paymentIntentId' },
  { model: EventTicketPurchase, sourceModel: 'EventTicketPurchase', sourcePaymentField: 'paymentIntentId' }
];

const CHECKOUT_SESSION_SOURCE_LOOKUP = [
  { model: Booking, sourceModel: 'Booking' },
  { model: BusinessOwnerBooking, sourceModel: 'BusinessOwnerBooking' },
  { model: Appointment, sourceModel: 'Appointment' },
  { model: BusinessOwnerAppointment, sourceModel: 'BusinessOwnerAppointment' },
  { model: EventTicketPurchase, sourceModel: 'EventTicketPurchase' }
];

const findRefundSourceByPaymentIntent = async (paymentIntentId) => {
  for (const entry of REFUND_SOURCE_LOOKUP) {
    const doc = await entry.model.findOne({ [entry.sourcePaymentField]: paymentIntentId }).select('_id paymentStatus');
    if (doc) {
      return {
        doc,
        sourceModel: entry.sourceModel,
        sourcePaymentField: entry.sourcePaymentField
      };
    }
  }
  return null;
};

const findSourceByCheckoutSessionId = async (checkoutSessionId) => {
  for (const entry of CHECKOUT_SESSION_SOURCE_LOOKUP) {
    const doc = await entry.model
      .findOne({ checkoutSessionId })
      .select('_id paymentStatus paymentIntentId checkoutSessionId');

    if (doc) {
      return {
        doc,
        model: entry.model,
        sourceModel: entry.sourceModel,
        sourcePaymentField: 'paymentIntentId'
      };
    }
  }
  return null;
};

const resolveRefundTarget = async ({ transactionReference, stripe }) => {
  const normalizedReference = String(transactionReference || '').trim();

  if (normalizedReference.startsWith('pi_')) {
    const source = await findRefundSourceByPaymentIntent(normalizedReference);
    return {
      paymentIntentId: normalizedReference,
      source,
      inputType: 'payment_intent'
    };
  }

  if (normalizedReference.startsWith('cs_')) {
    const checkoutSource = await findSourceByCheckoutSessionId(normalizedReference);
    let resolvedPaymentIntentId = checkoutSource?.doc?.paymentIntentId || null;

    if (!resolvedPaymentIntentId) {
      const checkoutSession = await stripe.checkout.sessions.retrieve(normalizedReference);
      if (typeof checkoutSession?.payment_intent === 'string' && checkoutSession.payment_intent.startsWith('pi_')) {
        resolvedPaymentIntentId = checkoutSession.payment_intent;
      }
    }

    if (!resolvedPaymentIntentId) {
      return {
        paymentIntentId: null,
        source: checkoutSource,
        inputType: 'checkout_session'
      };
    }

    if (checkoutSource && !checkoutSource.doc.paymentIntentId) {
      await checkoutSource.model.updateOne(
        { _id: checkoutSource.doc._id },
        { $set: { paymentIntentId: resolvedPaymentIntentId } }
      );
      checkoutSource.doc.paymentIntentId = resolvedPaymentIntentId;
    }

    return {
      paymentIntentId: resolvedPaymentIntentId,
      source: checkoutSource || await findRefundSourceByPaymentIntent(resolvedPaymentIntentId),
      inputType: 'checkout_session'
    };
  }

  return {
    paymentIntentId: null,
    source: null,
    inputType: 'unknown'
  };
};

const markTransactionAsRefunded = async ({ sourceModel, sourceId }) => {
  const update = { paymentStatus: 'refunded' };

  switch (sourceModel) {
    case 'Booking': {
      const booking = await Booking.findById(sourceId).select('duePaymentIntentId');
      if (booking?.duePaymentIntentId) return false;
      await Booking.updateOne({ _id: sourceId }, { $set: update });
      return true;
    }
    case 'BusinessOwnerBooking': {
      const booking = await BusinessOwnerBooking.findById(sourceId).select('duePaymentIntentId');
      if (booking?.duePaymentIntentId) return false;
      await BusinessOwnerBooking.updateOne({ _id: sourceId }, { $set: update });
      return true;
    }
    case 'Appointment':
      await Appointment.updateOne({ _id: sourceId }, { $set: update });
      return true;
    case 'BusinessOwnerAppointment':
      await BusinessOwnerAppointment.updateOne({ _id: sourceId }, { $set: update });
      return true;
    case 'EventTicketPurchase':
      await EventTicketPurchase.updateOne({ _id: sourceId }, { $set: update });
      return true;
    default:
      return false;
  }
};

const buildRefundIdempotencyKey = ({ explicitKey, adminId, paymentIntentId, amountCents, reason, note }) => {
  if (explicitKey && String(explicitKey).trim()) {
    return String(explicitKey).trim();
  }

  return crypto
    .createHash('sha256')
    .update([
      String(adminId),
      paymentIntentId,
      String(amountCents),
      reason || '',
      note || ''
    ].join('|'))
    .digest('hex');
};

const parseOrderedIds = (orderedIds) => {
  if (!Array.isArray(orderedIds)) {
    return { error: 'orderedIds must be an array of ids.' };
  }

  if (orderedIds.length > MAX_DISCOVERY_PIN_ITEMS) {
    return { error: `orderedIds cannot exceed ${MAX_DISCOVERY_PIN_ITEMS} items.` };
  }

  const normalizedIds = orderedIds.map((id) => String(id).trim()).filter(Boolean);
  const uniqueIds = [...new Set(normalizedIds)];

  if (uniqueIds.length !== normalizedIds.length) {
    return { error: 'orderedIds must not contain duplicates.' };
  }

  const invalidIds = uniqueIds.filter((id) => !mongoose.Types.ObjectId.isValid(id));
  if (invalidIds.length > 0) {
    return { error: 'orderedIds contains invalid ObjectId values.', invalidIds };
  }

  return {
    ids: uniqueIds.map((id) => new mongoose.Types.ObjectId(id))
  };
};

const chunkArray = (items, size) => {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
};

const activeModerationFilter = {
  $or: [
    { moderationStatus: { $exists: false } },
    { moderationStatus: 'active' }
  ]
};

const recalculateProviderRating = async (providerId) => {
  const stats = await Review.aggregate([
    {
      $match: {
        providerId: new mongoose.Types.ObjectId(providerId),
        isActive: true,
        ...activeModerationFilter
      }
    },
    {
      $group: {
        _id: '$providerId',
        avgRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 }
      }
    }
  ]);

  if (stats.length === 0) {
    await Provider.findByIdAndUpdate(providerId, { rating: 0, totalReviews: 0 });
    return;
  }

  await Provider.findByIdAndUpdate(providerId, {
    rating: Math.round(stats[0].avgRating * 10) / 10,
    totalReviews: stats[0].totalReviews
  });
};

const recalculateEmployeeServiceRating = async (employeeServiceId) => {
  const [bookingStats, appointmentStats] = await Promise.all([
    BusinessOwnerBooking.aggregate([
      {
        $match: {
          employeeServiceId: new mongoose.Types.ObjectId(employeeServiceId),
          rating: { $ne: null },
          ...activeModerationFilter
        }
      },
      {
        $group: {
          _id: '$employeeServiceId',
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ]),
    BusinessOwnerAppointment.aggregate([
      {
        $match: {
          employeeServiceId: new mongoose.Types.ObjectId(employeeServiceId),
          rating: { $ne: null },
          ...activeModerationFilter
        }
      },
      {
        $group: {
          _id: '$employeeServiceId',
          avgRating: { $avg: '$rating' },
          totalReviews: { $sum: 1 }
        }
      }
    ])
  ]);

  const bookingCount = bookingStats[0]?.totalReviews || 0;
  const bookingAvg = bookingStats[0]?.avgRating || 0;
  const appointmentCount = appointmentStats[0]?.totalReviews || 0;
  const appointmentAvg = appointmentStats[0]?.avgRating || 0;
  const totalReviews = bookingCount + appointmentCount;
  const weightedAvg =
    totalReviews > 0
      ? ((bookingAvg * bookingCount) + (appointmentAvg * appointmentCount)) / totalReviews
      : 0;

  await EmployeeService.findByIdAndUpdate(employeeServiceId, {
    rating: Math.round(weightedAvg * 10) / 10,
    totalReviews
  });
};

/**
 * Admin Login
 * POST /api/admin/login
 */
exports.loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Find admin by email and include password
    const admin = await Admin.findOne({ email: email.toLowerCase() }).select('+password');

    if (!admin) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if admin is active
    if (!admin.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your admin account has been deactivated. Please contact support.'
      });
    }

    // Verify password
    const isPasswordValid = await admin.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    await admin.updateLastLogin();

    const tokenPayload = {
      adminId: admin._id,
      role: admin.role
    };
    const accessToken = generateAccessToken(tokenPayload);
    const refreshToken = generateRefreshToken(tokenPayload);
    const accessExpiresIn = getTokenExpiresIn('access');
    const refreshExpiresIn = getTokenExpiresIn('refresh');
    const refreshExpiresAt = new Date(Date.now() + refreshExpiresIn * 1000);

    await AdminRefreshToken.create({
      adminId: admin._id,
      token: crypto.createHash('sha256').update(refreshToken).digest('hex'),
      expiresAt: refreshExpiresAt,
      deviceInfo: {
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection.remoteAddress
      }
    });

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        admin: {
          id: admin._id,
          fullName: admin.fullName,
          email: admin.email,
          role: admin.role,
          permissions: admin.permissions,
          lastLogin: admin.lastLogin
        },
        accessToken,
        refreshToken,
        expiresIn: accessExpiresIn,
        tokenType: 'Bearer'
      }
    });

  } catch (error) {
    console.error('Admin login error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred during login',
      error: error.message
    });
  }
};

/**
 * Refresh Admin Access Token
 * POST /api/admin/refresh-token
 */
exports.refreshAdminToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token is required'
      });
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(refreshToken);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    if (!decoded.adminId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid refresh token type'
      });
    }

    const hashedToken = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const storedToken = await AdminRefreshToken.findOne({
      token: hashedToken,
      adminId: decoded.adminId
    });

    if (!storedToken || !storedToken.isValid()) {
      return res.status(401).json({
        success: false,
        message: 'Invalid or expired refresh token'
      });
    }

    const admin = await Admin.findById(decoded.adminId);
    if (!admin || !admin.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Admin not found or inactive'
      });
    }

    const tokenPayload = {
      adminId: admin._id,
      role: admin.role
    };
    const newAccessToken = generateAccessToken(tokenPayload);
    const newRefreshToken = generateRefreshToken(tokenPayload);

    const refreshExpiresIn = getTokenExpiresIn('refresh');
    const refreshExpiresAt = new Date(Date.now() + refreshExpiresIn * 1000);

    storedToken.isRevoked = true;
    storedToken.lastUsedAt = new Date();
    await storedToken.save();

    await AdminRefreshToken.create({
      adminId: admin._id,
      token: crypto.createHash('sha256').update(newRefreshToken).digest('hex'),
      expiresAt: refreshExpiresAt,
      deviceInfo: {
        userAgent: req.headers['user-agent'],
        ip: req.ip || req.connection.remoteAddress
      }
    });

    const accessExpiresIn = getTokenExpiresIn('access');

    return res.status(200).json({
      success: true,
      message: 'Token refreshed successfully',
      data: {
        accessToken: newAccessToken,
        refreshToken: newRefreshToken,
        expiresIn: accessExpiresIn,
        tokenType: 'Bearer'
      }
    });
  } catch (error) {
    console.error('Admin token refresh error:', error);
    res.status(500).json({
      success: false,
      message: 'Error refreshing token',
      error: error.message
    });
  }
};

/**
 * Get Admin Profile
 * GET /api/admin/me
 */
exports.getAdminProfile = async (req, res) => {
  try {
    res.status(200).json({
      success: true,
      data: {
        admin: req.admin
      }
    });
  } catch (error) {
    console.error('Get admin profile error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching admin profile',
      error: error.message
    });
  }
};

/**
 * Get Dashboard Statistics
 * GET /api/admin/dashboard/stats
 */
exports.getDashboardStats = async (req, res) => {
  try {
    const { year } = req.query;
    const reportYear = parseInt(year, 10) || new Date().getFullYear();
    const startOfYear = new Date(Date.UTC(reportYear, 0, 1));
    const endOfYear = new Date(Date.UTC(reportYear + 1, 0, 1));

    // Get counts
    const totalUsers = await User.countDocuments({ userType: 'user' });
    const totalProviders = await Provider.countDocuments();
    const totalBusinessOwners = await BusinessOwner.countDocuments();
    const totalEventManagers = await EventManager.countDocuments();
    const pendingProviders = await Provider.countDocuments({ verificationStatus: 'pending' });
    const approvedProviders = await Provider.countDocuments({ verificationStatus: 'approved' });
    const rejectedProviders = await Provider.countDocuments({ verificationStatus: 'rejected' });

    const paidStatuses = ['partial', 'completed', 'offline_paid'];

    const [
      bookingEarnings,
      appointmentEarnings,
      boBookingEarnings,
      boAppointmentEarnings
    ] = await Promise.all([
      Booking.aggregate([
        { $match: { paymentStatus: { $in: paidStatuses } } },
        { $group: { _id: null, total: { $sum: '$platformFee' } } }
      ]),
      Appointment.aggregate([
        { $match: { paymentStatus: { $in: ['completed', 'offline_paid'] } } },
        { $group: { _id: null, total: { $sum: '$platformFee' } } }
      ]),
      BusinessOwnerBooking.aggregate([
        { $match: { paymentStatus: { $in: paidStatuses } } },
        { $group: { _id: null, total: { $sum: '$platformFee' } } }
      ]),
      BusinessOwnerAppointment.aggregate([
        { $match: { paymentStatus: { $in: ['completed', 'offline_paid'] } } },
        { $group: { _id: null, total: { $sum: '$platformFee' } } }
      ])
    ]);

    const totalEarnings =
      (bookingEarnings[0]?.total || 0) +
      (appointmentEarnings[0]?.total || 0) +
      (boBookingEarnings[0]?.total || 0) +
      (boAppointmentEarnings[0]?.total || 0);

    const monthlyPipeline = (match, collection) =>
      collection.aggregate([
        { $match: match },
        {
          $group: {
            _id: { $month: '$createdAt' },
            total: { $sum: '$platformFee' }
          }
        }
      ]);

    const [monthlyBooking, monthlyAppointment, monthlyBoBooking, monthlyBoAppointment] =
      await Promise.all([
        monthlyPipeline(
          { paymentStatus: { $in: paidStatuses }, createdAt: { $gte: startOfYear, $lt: endOfYear } },
          Booking
        ),
        monthlyPipeline(
          { paymentStatus: { $in: ['completed', 'offline_paid'] }, createdAt: { $gte: startOfYear, $lt: endOfYear } },
          Appointment
        ),
        monthlyPipeline(
          { paymentStatus: { $in: paidStatuses }, createdAt: { $gte: startOfYear, $lt: endOfYear } },
          BusinessOwnerBooking
        ),
        monthlyPipeline(
          { paymentStatus: { $in: ['completed', 'offline_paid'] }, createdAt: { $gte: startOfYear, $lt: endOfYear } },
          BusinessOwnerAppointment
        )
      ]);

    const monthlyTotals = Array.from({ length: 12 }, () => 0);
    const addMonthly = (items) => {
      items.forEach((row) => {
        const idx = row._id - 1;
        if (idx >= 0 && idx < 12) monthlyTotals[idx] += row.total || 0;
      });
    };
    addMonthly(monthlyBooking);
    addMonthly(monthlyAppointment);
    addMonthly(monthlyBoBooking);
    addMonthly(monthlyBoAppointment);

    // Get recent registrations
    const recentUsers = await User.find({ userType: 'user' })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('fullName email createdAt isActive');

    const recentProviders = await Provider.find()
      .populate('userId', 'fullName email phoneNumber')
      .sort({ createdAt: -1 })
      .limit(5);

    res.status(200).json({
      success: true,
      data: {
        stats: {
          totals: {
            totalEarnings,
            totalUsers,
            totalProviders,
            totalBusinessOwners,
            totalEventManagers
          },
          users: {
            total: totalUsers
          },
          providers: {
            total: totalProviders,
            pending: pendingProviders,
            approved: approvedProviders,
            rejected: rejectedProviders
          },
          earnings: {
            year: reportYear,
            monthly: monthlyTotals
          }
        },
        recent: {
          users: recentUsers,
          providers: recentProviders
        }
      }
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching dashboard statistics',
      error: error.message
    });
  }
};

/**
 * Get All Providers
 * GET /api/admin/providers
 */
exports.getAllProviders = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const query = {};
    if (status) {
      query.verificationStatus = status;
    }

    const providers = await Provider.find(query)
      .populate('userId', 'fullName email phoneNumber isActive createdAt')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Provider.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        providers,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        total: count
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

/**
 * Get Provider Details
 * GET /api/admin/providers/:id
 */
exports.getProviderDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const provider = await Provider.findById(id)
      .populate('userId', '-password -resetPasswordOTP -resetPasswordOTPExpires');

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        provider
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
 * Approve Provider
 * PUT /api/admin/providers/:id/approve
 */
exports.approveProvider = async (req, res) => {
  try {
    const { id } = req.params;

    const provider = await Provider.findById(id);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    await provider.approve();

    res.status(200).json({
      success: true,
      message: 'Provider approved successfully',
      data: {
        provider
      }
    });

  } catch (error) {
    console.error('Approve provider error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while approving provider',
      error: error.message
    });
  }
};

/**
 * Reject Provider
 * PUT /api/admin/providers/:id/reject
 */
exports.rejectProvider = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({
        success: false,
        message: 'Rejection reason is required'
      });
    }

    const provider = await Provider.findById(id);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    await provider.reject(reason);

    res.status(200).json({
      success: true,
      message: 'Provider rejected successfully',
      data: {
        provider
      }
    });

  } catch (error) {
    console.error('Reject provider error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while rejecting provider',
      error: error.message
    });
  }
};

/**
 * Get All Users
 * GET /api/admin/users
 */
exports.getAllUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;

    const query = { userType: 'user' };

    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }

    const users = await User.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-password -resetPasswordOTP -resetPasswordOTPExpires');

    const count = await User.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        users,
        totalPages: Math.ceil(count / limit),
        currentPage: page,
        total: count
      }
    });

  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching users',
      error: error.message
    });
  }
};

/**
 * Get Transactions (Admin)
 * GET /api/admin/transactions
 * @query type, status, page, limit, search, from, to
 */
exports.getTransactions = async (req, res) => {
  try {
    const {
      type = 'all',
      status,
      page = 1,
      limit = 20,
      search,
      from,
      to
    } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const startDate = from ? new Date(from) : null;
    const endDate = to ? new Date(to) : null;

    const buildDateQuery = () => {
      if (!startDate && !endDate) return {};
      const range = {};
      if (startDate && !Number.isNaN(startDate.getTime())) range.$gte = startDate;
      if (endDate && !Number.isNaN(endDate.getTime())) range.$lte = endDate;
      return Object.keys(range).length ? { createdAt: range } : {};
    };

    const dateQuery = buildDateQuery();

    const matchPaymentStatus = status ? { paymentStatus: status } : {};
    const searchRegex = search ? new RegExp(search, 'i') : null;

    const results = [];

    if (type === 'all' || type === 'provider') {
      const providerBookingQuery = { ...dateQuery, ...matchPaymentStatus };
      const providerAppointmentQuery = { ...dateQuery, ...matchPaymentStatus };

      const [bookings, appointments] = await Promise.all([
        Booking.find(providerBookingQuery)
          .populate('userId', 'fullName email phoneNumber bankInformation')
          .populate({
            path: 'providerId',
            populate: { path: 'userId', select: 'fullName email phoneNumber bankInformation' }
          }),
        Appointment.find(providerAppointmentQuery)
          .populate('userId', 'fullName email phoneNumber bankInformation')
          .populate({
            path: 'providerId',
            populate: { path: 'userId', select: 'fullName email phoneNumber bankInformation' }
          })
      ]);

      bookings.forEach((b) => {
        const userName = b.userId?.fullName || '';
        const providerName = b.providerId?.userId?.fullName || '';
        if (searchRegex && !searchRegex.test(userName) && !searchRegex.test(providerName)) return;
        results.push({
          source: 'user_provider_booking',
          orderId: b._id,
          transactionId: b.paymentIntentId || b.duePaymentIntentId || b.checkoutSessionId || null,
          paymentIntentId: b.paymentIntentId || null,
          duePaymentIntentId: b.duePaymentIntentId || null,
          checkoutSessionId: b.checkoutSessionId || null,
          userName,
          providerName,
          paymentStatus: b.paymentStatus,
          paymentIntentStatus: b.paymentIntentStatus,
          duePaymentIntentStatus: b.duePaymentIntentStatus,
          amount: b.totalAmount,
          downPayment: b.downPayment,
          dueAmount: b.dueAmount,
          remainingAmount: b.remainingAmount,
          paidVia: b.paidVia,
          status: b.bookingStatus,
          date: b.createdAt,
          paidAt: b.duePaidAt || b.offlinePaidAt || null,
          userBankInformation: b.userId?.bankInformation || null,
          providerBankInformation: b.providerId?.userId?.bankInformation || null
        });
      });

      appointments.forEach((a) => {
        const userName = a.userId?.fullName || '';
        const providerName = a.providerId?.userId?.fullName || '';
        if (searchRegex && !searchRegex.test(userName) && !searchRegex.test(providerName)) return;
        results.push({
          source: 'user_provider_appointment',
          orderId: a._id,
          transactionId: a.paymentIntentId || a.checkoutSessionId || null,
          paymentIntentId: a.paymentIntentId || null,
          duePaymentIntentId: null,
          checkoutSessionId: a.checkoutSessionId || null,
          userName,
          providerName,
          paymentStatus: a.paymentStatus,
          paymentIntentStatus: a.paymentIntentStatus,
          duePaymentIntentStatus: null,
          amount: a.totalAmount,
          downPayment: a.downPayment,
          dueAmount: 0,
          remainingAmount: a.remainingAmount,
          paidVia: a.paidVia,
          status: a.appointmentStatus,
          date: a.createdAt,
          paidAt: a.paidAt || null,
          userBankInformation: a.userId?.bankInformation || null,
          providerBankInformation: a.providerId?.userId?.bankInformation || null
        });
      });
    }

    if (type === 'all' || type === 'businessOwner') {
      const boBookingQuery = { ...dateQuery, ...matchPaymentStatus };
      const boAppointmentQuery = { ...dateQuery, ...matchPaymentStatus };

      const [boBookings, boAppointments] = await Promise.all([
        BusinessOwnerBooking.find(boBookingQuery)
          .populate('userId', 'fullName email phoneNumber bankInformation')
          .populate({
            path: 'businessOwnerId',
            populate: { path: 'userId', select: 'fullName email phoneNumber' }
          }),
        BusinessOwnerAppointment.find(boAppointmentQuery)
          .populate('userId', 'fullName email phoneNumber bankInformation')
          .populate({
            path: 'businessOwnerId',
            populate: { path: 'userId', select: 'fullName email phoneNumber' }
          })
      ]);

      boBookings.forEach((b) => {
        const userName = b.userId?.fullName || '';
        const businessOwnerName = b.businessOwnerId?.userId?.fullName || '';
        if (searchRegex && !searchRegex.test(userName) && !searchRegex.test(businessOwnerName)) return;
        results.push({
          source: 'user_business_owner_booking',
          orderId: b._id,
          transactionId: b.paymentIntentId || b.duePaymentIntentId || b.checkoutSessionId || null,
          paymentIntentId: b.paymentIntentId || null,
          duePaymentIntentId: b.duePaymentIntentId || null,
          checkoutSessionId: b.checkoutSessionId || null,
          userName,
          businessOwnerName,
          paymentStatus: b.paymentStatus,
          paymentIntentStatus: b.paymentIntentStatus,
          duePaymentIntentStatus: b.duePaymentIntentStatus,
          amount: b.totalAmount,
          downPayment: b.downPayment,
          dueAmount: b.dueAmount,
          remainingAmount: b.remainingAmount,
          paidVia: b.paidVia,
          status: b.bookingStatus,
          date: b.createdAt,
          paidAt: b.duePaidAt || b.offlinePaidAt || null,
          userBankInformation: b.userId?.bankInformation || null,
          businessOwnerBankInformation: b.businessOwnerId?.bankInformation || null
        });
      });

      boAppointments.forEach((a) => {
        const userName = a.userId?.fullName || '';
        const businessOwnerName = a.businessOwnerId?.userId?.fullName || '';
        if (searchRegex && !searchRegex.test(userName) && !searchRegex.test(businessOwnerName)) return;
        results.push({
          source: 'user_business_owner_appointment',
          orderId: a._id,
          transactionId: a.paymentIntentId || a.checkoutSessionId || null,
          paymentIntentId: a.paymentIntentId || null,
          duePaymentIntentId: null,
          checkoutSessionId: a.checkoutSessionId || null,
          userName,
          businessOwnerName,
          paymentStatus: a.paymentStatus,
          paymentIntentStatus: a.paymentIntentStatus,
          duePaymentIntentStatus: null,
          amount: a.totalAmount,
          downPayment: a.downPayment,
          dueAmount: 0,
          remainingAmount: a.remainingAmount,
          paidVia: a.paidVia,
          status: a.appointmentStatus,
          date: a.createdAt,
          paidAt: a.paidAt || null,
          userBankInformation: a.userId?.bankInformation || null,
          businessOwnerBankInformation: a.businessOwnerId?.bankInformation || null
        });
      });
    }

    if (type === 'all' || type === 'eventManager') {
      const ticketQuery = { ...dateQuery, ...matchPaymentStatus };

      const ticketPurchases = await EventTicketPurchase.find(ticketQuery)
        .populate('userId', 'fullName email phoneNumber bankInformation')
        .populate('eventId', 'eventName eventLocation eventStartDateTime eventEndDateTime ticketPrice')
        .populate({
          path: 'eventManagerId',
          populate: { path: 'userId', select: 'fullName email phoneNumber' }
        });

      ticketPurchases.forEach((t) => {
        const userName = t.userId?.fullName || '';
        const eventManagerName = t.eventManagerId?.userId?.fullName || '';
        if (searchRegex && !searchRegex.test(userName) && !searchRegex.test(eventManagerName)) return;
        results.push({
          source: 'user_event_manager_ticket',
          orderId: t._id,
          transactionId: t.paymentIntentId || t.checkoutSessionId || null,
          paymentIntentId: t.paymentIntentId || null,
          duePaymentIntentId: null,
          checkoutSessionId: t.checkoutSessionId || null,
          userName,
          eventManagerName,
          paymentStatus: t.paymentStatus,
          paymentIntentStatus: t.paymentIntentStatus,
          duePaymentIntentStatus: null,
          amount: t.totalAmount,
          downPayment: 0,
          dueAmount: 0,
          remainingAmount: 0,
          paidVia: t.paymentStatus === 'completed' ? 'online' : null,
          status: t.paymentStatus,
          date: t.createdAt,
          paidAt: t.paidAt || null,
          userBankInformation: t.userId?.bankInformation || null,
          eventManagerBankInformation: null,
          event: {
            id: t.eventId?._id || null,
            name: t.eventId?.eventName || null,
            location: t.eventId?.eventLocation || null,
            startDateTime: t.eventId?.eventStartDateTime || null,
            endDateTime: t.eventId?.eventEndDateTime || null
          },
          quantity: t.quantity
        });
      });
    }

    results.sort((a, b) => new Date(b.date) - new Date(a.date));

    const total = results.length;
    const totalPages = Math.ceil(total / limitNum);
    const start = (pageNum - 1) * limitNum;
    const data = results.slice(start, start + limitNum);

    res.status(200).json({
      success: true,
      data: {
        transactions: data,
        total,
        currentPage: pageNum,
        totalPages,
        filters: {
          type,
          status: status || null,
          search: search || null,
          from: from || null,
          to: to || null
        },
        eventManagerTransactionsSupported: true
      }
    });
  } catch (error) {
    console.error('Get transactions error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching transactions',
      error: error.message
    });
  }
};

/**
 * Refund Transaction (Admin)
 * POST /api/admin/transactions/refund
 * @body paymentIntentId, amount (optional), reason (optional), note (optional), idempotencyKey (optional)
 */
exports.refundTransaction = async (req, res) => {
  let refundLog = null;

  try {
    const {
      paymentIntentId,
      transactionId,
      checkoutSessionId,
      amount,
      reason,
      note,
      idempotencyKey
    } = req.body;

    const transactionReference = paymentIntentId || transactionId || checkoutSessionId;

    if (!transactionReference || typeof transactionReference !== 'string') {
      return res.status(400).json({
        success: false,
        message: 'paymentIntentId, transactionId, or checkoutSessionId is required'
      });
    }

    const normalizedReference = transactionReference.trim();
    if (!normalizedReference.startsWith('pi_') && !normalizedReference.startsWith('cs_')) {
      return res.status(400).json({
        success: false,
        message: 'transaction reference must start with pi_ or cs_'
      });
    }

    const normalizedReason = reason ? String(reason).trim() : null;
    const normalizedNote = note ? String(note).trim() : null;

    if (normalizedNote && normalizedNote.length > 1000) {
      return res.status(400).json({
        success: false,
        message: 'note cannot exceed 1000 characters'
      });
    }

    let requestedAmountCents = null;
    if (amount !== undefined && amount !== null && amount !== '') {
      const parsedAmount = Number(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'amount must be a positive number'
        });
      }
      requestedAmountCents = Math.round(parsedAmount * 100);
      if (requestedAmountCents <= 0) {
        return res.status(400).json({
          success: false,
          message: 'amount is too small'
        });
      }
    }

    const stripe = getStripe();
    let resolvedTarget = null;
    try {
      resolvedTarget = await resolveRefundTarget({
        transactionReference: normalizedReference,
        stripe
      });
    } catch (resolveError) {
      return res.status(400).json({
        success: false,
        message: 'Invalid checkout session or unable to resolve payment intent',
        error: resolveError.message
      });
    }

    const normalizedPaymentIntentId = resolvedTarget.paymentIntentId;
    const source = resolvedTarget.source;

    if (!normalizedPaymentIntentId) {
      return res.status(400).json({
        success: false,
        message: 'Could not resolve a payment intent from the provided transaction reference'
      });
    }

    if (!source) {
      return res.status(404).json({
        success: false,
        message: 'No local transaction found for the resolved payment intent'
      });
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(normalizedPaymentIntentId);

    if (!paymentIntent) {
      return res.status(404).json({
        success: false,
        message: 'Stripe payment intent not found'
      });
    }

    if (paymentIntent.status !== 'succeeded') {
      return res.status(400).json({
        success: false,
        message: `Payment intent is not refundable in current status: ${paymentIntent.status}`
      });
    }

    const refunds = await stripe.refunds.list({
      payment_intent: normalizedPaymentIntentId,
      limit: 100
    });

    const alreadyRefundedCents = refunds.data
      .filter((item) => !['failed', 'canceled'].includes(item.status))
      .reduce((sum, item) => sum + (item.amount || 0), 0);

    const capturedAmountCents = paymentIntent.amount_received || paymentIntent.amount || 0;
    const remainingRefundableCents = Math.max(capturedAmountCents - alreadyRefundedCents, 0);

    if (remainingRefundableCents <= 0) {
      return res.status(400).json({
        success: false,
        message: 'This payment is already fully refunded'
      });
    }

    const finalRefundAmountCents = requestedAmountCents || remainingRefundableCents;
    if (finalRefundAmountCents > remainingRefundableCents) {
      return res.status(400).json({
        success: false,
        message: `Requested amount exceeds remaining refundable amount (${(remainingRefundableCents / 100).toFixed(2)})`
      });
    }

    const resolvedIdempotencyKey = buildRefundIdempotencyKey({
      explicitKey: idempotencyKey,
      adminId: req.admin._id,
      paymentIntentId: normalizedPaymentIntentId,
      amountCents: finalRefundAmountCents,
      reason: normalizedReason,
      note: normalizedNote
    });

    const existing = await PaymentRefundLog.findOne({ idempotencyKey: resolvedIdempotencyKey });
    if (existing) {
      if (['succeeded', 'pending', 'requires_action', 'requested'].includes(existing.status)) {
        return res.status(200).json({
          success: true,
          message: 'Refund request already exists for this idempotency key',
          data: { refundLog: existing, idempotentReplay: true }
        });
      }

      return res.status(409).json({
        success: false,
        message: 'A failed/canceled refund request already uses this idempotency key. Use a new key to retry.'
      });
    }

    refundLog = await PaymentRefundLog.create({
      paymentIntentId: normalizedPaymentIntentId,
      sourceModel: source.sourceModel,
      sourceId: source.doc._id,
      sourcePaymentField: source.sourcePaymentField,
      amount: finalRefundAmountCents / 100,
      currency: (paymentIntent.currency || 'usd').toLowerCase(),
      reason: normalizedReason,
      note: normalizedNote,
      status: 'requested',
      idempotencyKey: resolvedIdempotencyKey,
      metadata: {
        paymentIntentStatus: paymentIntent.status,
        capturedAmount: capturedAmountCents / 100,
        alreadyRefundedAmount: alreadyRefundedCents / 100,
        remainingRefundableAmount: remainingRefundableCents / 100
      },
      refundedByAdminId: req.admin._id
    });

    const stripeReason = STRIPE_REFUND_REASONS.includes(normalizedReason)
      ? normalizedReason
      : undefined;

    const refundPayload = {
      payment_intent: normalizedPaymentIntentId,
      metadata: {
        adminId: req.admin._id.toString(),
        sourceModel: source.sourceModel,
        sourceId: source.doc._id.toString(),
        note: normalizedNote || ''
      }
    };

    if (finalRefundAmountCents !== remainingRefundableCents) {
      refundPayload.amount = finalRefundAmountCents;
    }
    if (stripeReason) {
      refundPayload.reason = stripeReason;
    }

    const refund = await stripe.refunds.create(
      refundPayload,
      { idempotencyKey: resolvedIdempotencyKey }
    );

    refundLog.refundId = refund.id || null;
    refundLog.status = refund.status || 'pending';
    refundLog.stripeError = null;
    refundLog.metadata = {
      ...refundLog.metadata,
      stripeReason: stripeReason || null,
      stripeRefundStatus: refund.status || null
    };
    await refundLog.save();

    let localStatusUpdated = false;
    const isFullRefund = finalRefundAmountCents === remainingRefundableCents;
    if (isFullRefund && refund.status === 'succeeded') {
      localStatusUpdated = await markTransactionAsRefunded({
        sourceModel: source.sourceModel,
        sourceId: source.doc._id
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Refund processed successfully',
      data: {
        refund: {
          id: refund.id,
          status: refund.status,
          amount: (refund.amount || finalRefundAmountCents) / 100,
          currency: (refund.currency || paymentIntent.currency || 'usd').toLowerCase(),
          paymentIntentId: normalizedPaymentIntentId
        },
        resolvedFrom: {
          inputReference: normalizedReference,
          inputType: resolvedTarget.inputType,
          paymentIntentId: normalizedPaymentIntentId
        },
        transaction: {
          sourceModel: source.sourceModel,
          sourceId: source.doc._id,
          sourcePaymentField: source.sourcePaymentField
        },
        fullRefundRequested: isFullRefund,
        localStatusUpdated,
        refundLogId: refundLog._id
      }
    });
  } catch (error) {
    if (refundLog) {
      try {
        refundLog.status = 'failed';
        refundLog.stripeError = error.message || 'Refund failed';
        await refundLog.save();
      } catch (saveError) {
        console.error('Failed to persist refund failure log:', saveError);
      }
    }

    console.error('Refund transaction error:', error);
    return res.status(500).json({
      success: false,
      message: 'Error processing refund',
      error: error.message
    });
  }
};

/**
 * Get Refund Logs (Admin)
 * GET /api/admin/transactions/refunds
 * @query page, limit, status, paymentIntentId, sourceModel, refundedByAdminId, from, to, search
 */
exports.getRefundLogs = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      paymentIntentId,
      sourceModel,
      refundedByAdminId,
      from,
      to,
      search
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const query = {};

    if (status) {
      query.status = String(status).trim();
    }

    if (paymentIntentId) {
      query.paymentIntentId = String(paymentIntentId).trim();
    }

    if (sourceModel) {
      query.sourceModel = String(sourceModel).trim();
    }

    if (refundedByAdminId && mongoose.Types.ObjectId.isValid(refundedByAdminId)) {
      query.refundedByAdminId = refundedByAdminId;
    }

    const dateQuery = {};
    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) {
        dateQuery.$gte = fromDate;
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) {
        dateQuery.$lte = toDate;
      }
    }
    if (Object.keys(dateQuery).length > 0) {
      query.createdAt = dateQuery;
    }

    if (search && String(search).trim()) {
      const searchRegex = new RegExp(String(search).trim(), 'i');
      query.$or = [
        { paymentIntentId: searchRegex },
        { refundId: searchRegex },
        { note: searchRegex },
        { reason: searchRegex },
        { stripeError: searchRegex }
      ];
    }

    const skip = (pageNum - 1) * limitNum;

    const [logs, total] = await Promise.all([
      PaymentRefundLog.find(query)
        .populate('refundedByAdminId', 'fullName email role')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      PaymentRefundLog.countDocuments(query)
    ]);

    res.status(200).json({
      success: true,
      data: {
        refundLogs: logs,
        total,
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum),
        filters: {
          status: status || null,
          paymentIntentId: paymentIntentId || null,
          sourceModel: sourceModel || null,
          refundedByAdminId: refundedByAdminId || null,
          from: from || null,
          to: to || null,
          search: search || null
        }
      }
    });
  } catch (error) {
    console.error('Get refund logs error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching refund logs',
      error: error.message
    });
  }
};

/**
 * Get User by ID
 * GET /api/admin/users/:id
 */
exports.getUserById = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findOne({ _id: id, userType: 'user' })
      .select('-password -resetPasswordOTP -resetPasswordOTPExpires');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        user
      }
    });
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching user',
      error: error.message
    });
  }
};

/**
 * Toggle User Active Status
 * PUT /api/admin/users/:id/toggle-status
 */
exports.toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.status(200).json({
      success: true,
      message: `User ${user.isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        user
      }
    });

  } catch (error) {
    console.error('Toggle user status error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating user status',
      error: error.message
    });
  }
};

/**
 * Delete User Account Permanently
 * DELETE /api/admin/users/:id
 */
exports.deleteUser = async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Make sure we're only deleting regular users
    if (user.userType !== 'user') {
      return res.status(400).json({
        success: false,
        message: 'This endpoint is only for deleting regular users'
      });
    }

    // Delete profile picture from Cloudinary if exists
    if (user.profilePicture) {
      try {
        const urlParts = user.profilePicture.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting profile picture:', err);
      }
    }

    // Delete the user account
    await User.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'User account deleted permanently'
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting user',
      error: error.message
    });
  }
};

/**
 * Toggle Provider Active Status (Block/Unblock)
 * PUT /api/admin/providers/:id/toggle-status
 */
exports.toggleProviderStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const provider = await Provider.findById(id);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    // Toggle the user's isActive status
    const user = await User.findById(provider.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.status(200).json({
      success: true,
      message: `Provider ${user.isActive ? 'unblocked' : 'blocked'} successfully`,
      data: {
        provider: {
          id: provider._id,
          userId: user._id,
          fullName: user.fullName,
          email: user.email,
          isActive: user.isActive
        }
      }
    });

  } catch (error) {
    console.error('Toggle provider status error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating provider status',
      error: error.message
    });
  }
};

/**
 * Delete Provider Account Permanently
 * DELETE /api/admin/providers/:id
 */
exports.deleteProvider = async (req, res) => {
  try {
    const { id } = req.params;

    const provider = await Provider.findById(id);

    if (!provider) {
      return res.status(404).json({
        success: false,
        message: 'Provider not found'
      });
    }

    const userId = provider.userId;

    // Delete ID card images from Cloudinary if they exist
    if (provider.idCard?.frontImage) {
      try {
        const urlParts = provider.idCard.frontImage.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting front ID card image:', err);
      }
    }

    if (provider.idCard?.backImage) {
      try {
        const urlParts = provider.idCard.backImage.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting back ID card image:', err);
      }
    }

    // Delete profile picture from Cloudinary if exists
    const user = await User.findById(userId);
    if (user?.profilePicture) {
      try {
        const urlParts = user.profilePicture.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting profile picture:', err);
      }
    }

    // Delete the provider profile
    await Provider.findByIdAndDelete(id);

    // Delete the user account
    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: 'Provider account deleted permanently'
    });

  } catch (error) {
    console.error('Delete provider error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting provider',
      error: error.message
    });
  }
};

/**
 * Get provider reviews for moderation
 * GET /api/admin/reviews/providers
 */
exports.getProviderReviews = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      moderationStatus,
      minRating,
      maxRating
    } = req.query;

    const query = {};
    if (moderationStatus && ['active', 'hidden_by_admin'].includes(moderationStatus)) {
      query.moderationStatus = moderationStatus;
    }
    if (minRating || maxRating) {
      query.rating = {};
      if (minRating) query.rating.$gte = Number(minRating);
      if (maxRating) query.rating.$lte = Number(maxRating);
    }

    if (search) {
      const users = await User.find({
        fullName: { $regex: search, $options: 'i' }
      }).select('_id');
      const userIds = users.map((user) => user._id);
      query.$or = [
        { comment: { $regex: search, $options: 'i' } },
        { userId: { $in: userIds } }
      ];
    }

    const reviews = await Review.find(query)
      .populate('userId', 'fullName profilePicture')
      .populate({
        path: 'providerId',
        select: 'userId',
        populate: { path: 'userId', select: 'fullName profilePicture' }
      })
      .sort({ createdAt: -1 })
      .skip((parseInt(page, 10) - 1) * parseInt(limit, 10))
      .limit(parseInt(limit, 10));

    const total = await Review.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        reviews,
        total,
        currentPage: parseInt(page, 10),
        totalPages: Math.ceil(total / parseInt(limit, 10))
      }
    });
  } catch (error) {
    console.error('Get provider reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching provider reviews',
      error: error.message
    });
  }
};

/**
 * Hide provider review
 * PATCH /api/admin/reviews/providers/:id/hide
 */
exports.hideProviderReview = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Moderation reason is required.'
      });
    }

    const review = await Review.findById(id);
    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    review.moderationStatus = 'hidden_by_admin';
    review.moderationReason = String(reason).trim();
    review.moderatedBy = req.admin._id;
    review.moderatedAt = new Date();
    await review.save();

    await recalculateProviderRating(review.providerId);

    res.status(200).json({
      success: true,
      message: 'Review hidden successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Hide provider review error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while hiding provider review',
      error: error.message
    });
  }
};

/**
 * Restore provider review
 * PATCH /api/admin/reviews/providers/:id/restore
 */
exports.restoreProviderReview = async (req, res) => {
  try {
    const { id } = req.params;
    const review = await Review.findById(id);

    if (!review) {
      return res.status(404).json({
        success: false,
        message: 'Review not found'
      });
    }

    review.moderationStatus = 'active';
    review.moderationReason = null;
    review.moderatedBy = null;
    review.moderatedAt = null;
    await review.save();

    await recalculateProviderRating(review.providerId);

    res.status(200).json({
      success: true,
      message: 'Review restored successfully',
      data: { review }
    });
  } catch (error) {
    console.error('Restore provider review error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while restoring provider review',
      error: error.message
    });
  }
};

/**
 * Get business reviews for moderation (bookings + appointments)
 * GET /api/admin/reviews/businesses
 */
exports.getBusinessReviews = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, moderationStatus } = req.query;
    const limitNum = parseInt(limit, 10);
    const pageNum = parseInt(page, 10);
    const skip = (pageNum - 1) * limitNum;

    const baseMatch = { rating: { $ne: null } };
    if (moderationStatus && ['active', 'hidden_by_admin'].includes(moderationStatus)) {
      baseMatch.moderationStatus = moderationStatus;
    }
    if (search) {
      baseMatch.review = { $regex: search, $options: 'i' };
    }

    const [bookings, appointments] = await Promise.all([
      BusinessOwnerBooking.find(baseMatch)
        .populate('userId', 'fullName profilePicture')
        .populate('employeeServiceId', 'headline')
        .sort({ reviewedAt: -1, createdAt: -1 })
        .select('userId employeeServiceId businessOwnerId rating review reviewedAt createdAt moderationStatus moderationReason moderatedBy moderatedAt'),
      BusinessOwnerAppointment.find(baseMatch)
        .populate('userId', 'fullName profilePicture')
        .populate('employeeServiceId', 'headline')
        .sort({ reviewedAt: -1, createdAt: -1 })
        .select('userId employeeServiceId businessOwnerId rating review reviewedAt createdAt moderationStatus moderationReason moderatedBy moderatedAt')
    ]);

    const merged = [
      ...bookings.map((item) => ({
        id: item._id,
        sourceType: 'booking',
        user: item.userId,
        employeeService: item.employeeServiceId,
        businessOwnerId: item.businessOwnerId,
        rating: item.rating,
        comment: item.review,
        reviewedAt: item.reviewedAt || item.createdAt,
        moderationStatus: item.moderationStatus || 'active',
        moderationReason: item.moderationReason || null,
        moderatedBy: item.moderatedBy || null,
        moderatedAt: item.moderatedAt || null
      })),
      ...appointments.map((item) => ({
        id: item._id,
        sourceType: 'appointment',
        user: item.userId,
        employeeService: item.employeeServiceId,
        businessOwnerId: item.businessOwnerId,
        rating: item.rating,
        comment: item.review,
        reviewedAt: item.reviewedAt || item.createdAt,
        moderationStatus: item.moderationStatus || 'active',
        moderationReason: item.moderationReason || null,
        moderatedBy: item.moderatedBy || null,
        moderatedAt: item.moderatedAt || null
      }))
    ]
      .sort((a, b) => new Date(b.reviewedAt) - new Date(a.reviewedAt));

    const paged = merged.slice(skip, skip + limitNum);

    res.status(200).json({
      success: true,
      data: {
        reviews: paged,
        total: merged.length,
        currentPage: pageNum,
        totalPages: Math.ceil(merged.length / limitNum)
      }
    });
  } catch (error) {
    console.error('Get business reviews error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching business reviews',
      error: error.message
    });
  }
};

/**
 * Hide business review
 * PATCH /api/admin/reviews/businesses/:sourceType/:id/hide
 */
exports.hideBusinessReview = async (req, res) => {
  try {
    const { sourceType, id } = req.params;
    const { reason } = req.body;

    if (!reason || !String(reason).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Moderation reason is required.'
      });
    }

    const Model = sourceType === 'booking'
      ? BusinessOwnerBooking
      : sourceType === 'appointment'
        ? BusinessOwnerAppointment
        : null;

    if (!Model) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sourceType. Use booking or appointment.'
      });
    }

    const reviewDoc = await Model.findById(id);
    if (!reviewDoc || reviewDoc.rating == null) {
      return res.status(404).json({
        success: false,
        message: 'Business review not found'
      });
    }

    reviewDoc.moderationStatus = 'hidden_by_admin';
    reviewDoc.moderationReason = String(reason).trim();
    reviewDoc.moderatedBy = req.admin._id;
    reviewDoc.moderatedAt = new Date();
    await reviewDoc.save();

    if (reviewDoc.employeeServiceId) {
      await recalculateEmployeeServiceRating(reviewDoc.employeeServiceId);
    }

    res.status(200).json({
      success: true,
      message: 'Business review hidden successfully'
    });
  } catch (error) {
    console.error('Hide business review error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while hiding business review',
      error: error.message
    });
  }
};

/**
 * Restore business review
 * PATCH /api/admin/reviews/businesses/:sourceType/:id/restore
 */
exports.restoreBusinessReview = async (req, res) => {
  try {
    const { sourceType, id } = req.params;
    const Model = sourceType === 'booking'
      ? BusinessOwnerBooking
      : sourceType === 'appointment'
        ? BusinessOwnerAppointment
        : null;

    if (!Model) {
      return res.status(400).json({
        success: false,
        message: 'Invalid sourceType. Use booking or appointment.'
      });
    }

    const reviewDoc = await Model.findById(id);
    if (!reviewDoc || reviewDoc.rating == null) {
      return res.status(404).json({
        success: false,
        message: 'Business review not found'
      });
    }

    reviewDoc.moderationStatus = 'active';
    reviewDoc.moderationReason = null;
    reviewDoc.moderatedBy = null;
    reviewDoc.moderatedAt = null;
    await reviewDoc.save();

    if (reviewDoc.employeeServiceId) {
      await recalculateEmployeeServiceRating(reviewDoc.employeeServiceId);
    }

    res.status(200).json({
      success: true,
      message: 'Business review restored successfully'
    });
  } catch (error) {
    console.error('Restore business review error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while restoring business review',
      error: error.message
    });
  }
};

/**
 * Get provider discovery ranking (pinned first order)
 * GET /api/admin/discovery/providers/ranking
 */
exports.getProviderDiscoveryRanking = async (req, res) => {
  try {
    const providers = await Provider.find({
      'discoveryPin.isPinned': true
    })
      .populate('userId', 'fullName profilePicture isActive')
      .sort({ 'discoveryPin.pinOrder': 1, 'discoveryPin.pinnedAt': 1, _id: 1 })
      .select('userId verificationStatus isAvailable discoveryPin');

    res.status(200).json({
      success: true,
      data: {
        providers: providers.map((provider) => ({
          providerId: provider._id,
          name: provider.userId?.fullName || null,
          profileImage: provider.userId?.profilePicture || null,
          isUserActive: provider.userId?.isActive !== false,
          verificationStatus: provider.verificationStatus,
          isAvailable: provider.isAvailable,
          pinOrder: provider.discoveryPin?.pinOrder ?? null,
          pinnedAt: provider.discoveryPin?.pinnedAt ?? null
        })),
        count: providers.length
      }
    });
  } catch (error) {
    console.error('Get provider discovery ranking error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching provider discovery ranking',
      error: error.message
    });
  }
};

/**
 * Bulk update provider discovery ranking
 * PUT /api/admin/discovery/providers/ranking
 * Body: { orderedIds: string[] }
 */
exports.updateProviderDiscoveryRanking = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    const parsed = parseOrderedIds(orderedIds);

    if (parsed.error) {
      return res.status(400).json({
        success: false,
        message: parsed.error,
        invalidIds: parsed.invalidIds || []
      });
    }

    const ids = parsed.ids;
    const existingProviders = await Provider.find({ _id: { $in: ids } }).select('_id').lean();
    const existingIdSet = new Set(existingProviders.map((provider) => String(provider._id)));
    const missingIds = ids.map((id) => String(id)).filter((id) => !existingIdSet.has(id));

    if (missingIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some provider ids were not found.',
        invalidIds: missingIds
      });
    }

    await Provider.updateMany(
      { 'discoveryPin.isPinned': true, _id: { $nin: ids } },
      {
        $set: {
          'discoveryPin.isPinned': false,
          'discoveryPin.pinOrder': null,
          'discoveryPin.pinnedAt': null,
          'discoveryPin.pinnedBy': null
        }
      }
    );

    if (ids.length > 0) {
      const pinnedAt = new Date();
      const bulkOps = ids.map((id, index) => ({
        updateOne: {
          filter: { _id: id },
          update: {
            $set: {
              'discoveryPin.isPinned': true,
              'discoveryPin.pinOrder': index + 1,
              'discoveryPin.pinnedAt': pinnedAt,
              'discoveryPin.pinnedBy': req.admin._id
            }
          }
        }
      }));

      await Provider.bulkWrite(bulkOps);
    }

    res.status(200).json({
      success: true,
      message: 'Provider discovery ranking updated successfully',
      data: {
        orderedIds: ids.map((id) => String(id)),
        count: ids.length
      }
    });
  } catch (error) {
    console.error('Update provider discovery ranking error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating provider discovery ranking',
      error: error.message
    });
  }
};

/**
 * Create New Admin (Super-admin only)
 * POST /api/admin/admins
 */
exports.createAdmin = async (req, res) => {
  try {
    const { fullName, email, password, role } = req.body;

    // Validate input
    if (!fullName || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Full name, email, and password are required'
      });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters long'
      });
    }

    // Validate role
    const validRoles = ['super-admin', 'admin'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role. Must be one of: ${validRoles.join(', ')}`
      });
    }

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email: email.toLowerCase() });

    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Admin with this email already exists'
      });
    }

    // Create new admin
    const admin = new Admin({
      fullName,
      email: email.toLowerCase(),
      password,
      role: role || 'admin',
      createdBy: req.admin._id
    });

    await admin.save();

    res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      data: {
        admin: {
          id: admin._id,
          fullName: admin.fullName,
          email: admin.email,
          role: admin.role,
          permissions: admin.permissions,
          isActive: admin.isActive,
          createdAt: admin.createdAt
        }
      }
    });

  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while creating admin',
      error: error.message
    });
  }
};

/**
 * Get All Admins (Super-admin only)
 * GET /api/admin/admins
 */
exports.getAllAdmins = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const admins = await Admin.find()
      .populate('createdBy', 'fullName email')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .select('-password -resetPasswordOTP -resetPasswordOTPExpires');

    const count = await Admin.countDocuments();

    res.status(200).json({
      success: true,
      data: {
        admins,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page),
        total: count
      }
    });

  } catch (error) {
    console.error('Get all admins error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching admins',
      error: error.message
    });
  }
};

/**
 * Get Admin by ID (Super-admin only)
 * GET /api/admin/admins/:id
 */
exports.getAdminById = async (req, res) => {
  try {
    const { id } = req.params;

    const admin = await Admin.findById(id)
      .populate('createdBy', 'fullName email')
      .select('-password -resetPasswordOTP -resetPasswordOTPExpires');

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        admin
      }
    });

  } catch (error) {
    console.error('Get admin by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching admin',
      error: error.message
    });
  }
};

/**
 * Update Admin (Super-admin only)
 * PUT /api/admin/admins/:id
 */
exports.updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, password, role, isActive } = req.body;

    const admin = await Admin.findById(id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    // Prevent super-admin from demoting themselves
    if (admin._id.toString() === req.admin._id.toString() && role && role !== 'super-admin') {
      return res.status(400).json({
        success: false,
        message: 'You cannot change your own role'
      });
    }

    // Check if email is being changed and already exists
    if (email && email.toLowerCase() !== admin.email) {
      const emailExists = await Admin.findOne({
        email: email.toLowerCase(),
        _id: { $ne: id }
      });

      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'Email already in use by another admin'
        });
      }
    }

    // Validate role if provided
    if (role) {
      const validRoles = ['super-admin', 'admin'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: `Invalid role. Must be one of: ${validRoles.join(', ')}`
        });
      }
    }

    // Update fields
    if (fullName) admin.fullName = fullName;
    if (email) admin.email = email.toLowerCase();
    if (role) admin.role = role;
    if (isActive !== undefined) admin.isActive = isActive;

    // Update password if provided
    if (password) {
      if (password.length < 8) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 8 characters long'
        });
      }
      admin.password = password;
    }

    await admin.save();

    res.status(200).json({
      success: true,
      message: 'Admin updated successfully',
      data: {
        admin: {
          id: admin._id,
          fullName: admin.fullName,
          email: admin.email,
          role: admin.role,
          permissions: admin.permissions,
          isActive: admin.isActive,
          updatedAt: admin.updatedAt
        }
      }
    });

  } catch (error) {
    console.error('Update admin error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating admin',
      error: error.message
    });
  }
};

/**
 * Delete Admin (Super-admin only)
 * DELETE /api/admin/admins/:id
 */
exports.deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent super-admin from deleting themselves
    if (id === req.admin._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot delete your own account'
      });
    }

    const admin = await Admin.findById(id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    await Admin.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Admin deleted successfully'
    });

  } catch (error) {
    console.error('Delete admin error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting admin',
      error: error.message
    });
  }
};

/**
 * Toggle Admin Active Status (Super-admin only)
 * PUT /api/admin/admins/:id/toggle-status
 */
exports.toggleAdminStatus = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent super-admin from deactivating themselves
    if (id === req.admin._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'You cannot deactivate your own account'
      });
    }

    const admin = await Admin.findById(id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    admin.isActive = !admin.isActive;
    await admin.save();

    res.status(200).json({
      success: true,
      message: `Admin ${admin.isActive ? 'activated' : 'deactivated'} successfully`,
      data: {
        admin: {
          id: admin._id,
          fullName: admin.fullName,
          email: admin.email,
          isActive: admin.isActive
        }
      }
    });

  } catch (error) {
    console.error('Toggle admin status error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating admin status',
      error: error.message
    });
  }
};

/**
 * Get All Business Owners
 * GET /api/admin/business-owners
 */
exports.getAllBusinessOwners = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;

    // Build search query for users
    let userQuery = { userType: 'businessOwner' };

    if (search) {
      userQuery.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Find matching user IDs first
    const matchingUsers = await User.find(userQuery).select('_id');
    const userIds = matchingUsers.map(u => u._id);

    const businessOwners = await BusinessOwner.find({ userId: { $in: userIds } })
      .populate('userId', 'fullName email phoneNumber isActive createdAt profilePicture')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await BusinessOwner.countDocuments({ userId: { $in: userIds } });

    res.status(200).json({
      success: true,
      data: {
        businessOwners,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page),
        total: count
      }
    });

  } catch (error) {
    console.error('Get all business owners error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching business owners',
      error: error.message
    });
  }
};

/**
 * Get Business Owner Details
 * GET /api/admin/business-owners/:id
 */
exports.getBusinessOwnerDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const businessOwner = await BusinessOwner.findById(id)
      .populate('userId', '-password -resetPasswordOTP -resetPasswordOTPExpires')
      .populate('businessCategory', 'name')
      .populate('businessProfile.categories', 'name');

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner not found'
      });
    }

    const totalEmployees = await Employee.countDocuments({ businessOwnerId: businessOwner._id });

    res.status(200).json({
      success: true,
      data: {
        businessOwner: {
          ...businessOwner.toObject(),
          totalEmployees
        }
      }
    });

  } catch (error) {
    console.error('Get business owner details error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching business owner details',
      error: error.message
    });
  }
};

/**
 * Get Business Owner Employees
 * GET /api/admin/business-owners/:id/employees
 */
exports.getBusinessOwnerEmployees = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, search } = req.query;

    const businessOwner = await BusinessOwner.findById(id);
    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner not found'
      });
    }

    const query = { businessOwnerId: id };
    if (search) {
      query.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { mobileNumber: { $regex: search, $options: 'i' } }
      ];
    }

    const employees = await Employee.find(query)
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Employee.countDocuments(query);

    const employeeIds = employees.map((e) => e._id);
    const serviceCounts = await EmployeeService.aggregate([
      { $match: { employeeId: { $in: employeeIds } } },
      { $group: { _id: '$employeeId', count: { $sum: 1 } } }
    ]);
    const serviceCountMap = new Map(serviceCounts.map((s) => [s._id.toString(), s.count]));

    const data = employees.map((e) => ({
      ...e.toObject(),
      serviceCount: serviceCountMap.get(e._id.toString()) || 0
    }));

    res.status(200).json({
      success: true,
      data: {
        businessOwnerId: id,
        employees: data,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page),
        total: count
      }
    });
  } catch (error) {
    console.error('Get business owner employees error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching employees',
      error: error.message
    });
  }
};

/**
 * Get Employee Details (Admin)
 * GET /api/admin/employees/:id
 */
exports.getEmployeeDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const employee = await Employee.findById(id)
      .populate('businessOwnerId', 'businessName businessCategory businessAddress');

    if (!employee) {
      return res.status(404).json({
        success: false,
        message: 'Employee not found'
      });
    }

    const services = await EmployeeService.find({ employeeId: id })
      .select('headline description basePrice appointmentEnabled isActive servicePhoto category createdAt updatedAt');

    res.status(200).json({
      success: true,
      data: {
        employee,
        services
      }
    });
  } catch (error) {
    console.error('Get employee details error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching employee details',
      error: error.message
    });
  }
};

/**
 * Get Events for an Event Manager (Admin)
 * GET /api/admin/event-managers/:id/events
 */
exports.getEventManagerEvents = async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20, search, status } = req.query;

    const eventManager = await EventManager.findById(id);
    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager not found'
      });
    }

    const query = { eventManagerId: id };
    if (status) {
      query.status = status;
    }
    if (search) {
      query.$or = [
        { eventName: { $regex: search, $options: 'i' } },
        { eventLocation: { $regex: search, $options: 'i' } },
        { eventManagerName: { $regex: search, $options: 'i' } }
      ];
    }

    const events = await Event.find(query)
      .sort({ eventStartDateTime: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await Event.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        eventManagerId: id,
        events,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page),
        total: count
      }
    });
  } catch (error) {
    console.error('Get event manager events error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching events',
      error: error.message
    });
  }
};

/**
 * Toggle Business Owner Active Status (Block/Unblock)
 * PUT /api/admin/business-owners/:id/toggle-status
 */
exports.toggleBusinessOwnerStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const businessOwner = await BusinessOwner.findById(id);

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner not found'
      });
    }

    // Toggle the user's isActive status
    const user = await User.findById(businessOwner.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.status(200).json({
      success: true,
      message: `Business owner ${user.isActive ? 'unblocked' : 'blocked'} successfully`,
      data: {
        businessOwner: {
          id: businessOwner._id,
          userId: user._id,
          fullName: user.fullName,
          email: user.email,
          isActive: user.isActive
        }
      }
    });

  } catch (error) {
    console.error('Toggle business owner status error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating business owner status',
      error: error.message
    });
  }
};

/**
 * Delete Business Owner Account Permanently
 * DELETE /api/admin/business-owners/:id
 */
exports.deleteBusinessOwner = async (req, res) => {
  try {
    const { id } = req.params;

    const businessOwner = await BusinessOwner.findById(id);

    if (!businessOwner) {
      return res.status(404).json({
        success: false,
        message: 'Business owner not found'
      });
    }

    const userId = businessOwner.userId;

    // Delete ID card images from Cloudinary if they exist
    if (businessOwner.idCard?.frontImage) {
      try {
        const urlParts = businessOwner.idCard.frontImage.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting front ID card image:', err);
      }
    }

    if (businessOwner.idCard?.backImage) {
      try {
        const urlParts = businessOwner.idCard.backImage.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting back ID card image:', err);
      }
    }

    // Delete profile picture from Cloudinary if exists
    const user = await User.findById(userId);
    if (user?.profilePicture) {
      try {
        const urlParts = user.profilePicture.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting profile picture:', err);
      }
    }

    // Delete the business owner profile
    await BusinessOwner.findByIdAndDelete(id);

    // Delete the user account
    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: 'Business owner account deleted permanently'
    });

  } catch (error) {
    console.error('Delete business owner error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting business owner',
      error: error.message
    });
  }
};

/**
 * Get business discovery ranking (pinned first order)
 * GET /api/admin/discovery/businesses/ranking
 */
exports.getBusinessDiscoveryRanking = async (req, res) => {
  try {
    const businesses = await BusinessOwner.find({
      'discoveryPin.isPinned': true
    })
      .populate('userId', 'isActive')
      .sort({ 'discoveryPin.pinOrder': 1, 'discoveryPin.pinnedAt': 1, _id: 1 })
      .select('businessName businessPhoto businessAddress businessProfile discoveryPin userId');

    res.status(200).json({
      success: true,
      data: {
        businesses: businesses.map((owner) => ({
          businessOwnerId: owner._id,
          businessName: owner.businessProfile?.name || owner.businessName || null,
          businessPhoto: owner.businessProfile?.coverPhoto || owner.businessPhoto || null,
          businessAddress: owner.businessProfile?.location || owner.businessAddress?.fullAddress || null,
          isUserActive: owner.userId?.isActive !== false,
          pinOrder: owner.discoveryPin?.pinOrder ?? null,
          pinnedAt: owner.discoveryPin?.pinnedAt ?? null
        })),
        count: businesses.length
      }
    });
  } catch (error) {
    console.error('Get business discovery ranking error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching business discovery ranking',
      error: error.message
    });
  }
};

/**
 * Bulk update business discovery ranking
 * PUT /api/admin/discovery/businesses/ranking
 * Body: { orderedIds: string[] }
 */
exports.updateBusinessDiscoveryRanking = async (req, res) => {
  try {
    const { orderedIds } = req.body;
    const parsed = parseOrderedIds(orderedIds);

    if (parsed.error) {
      return res.status(400).json({
        success: false,
        message: parsed.error,
        invalidIds: parsed.invalidIds || []
      });
    }

    const ids = parsed.ids;
    const existingBusinesses = await BusinessOwner.find({ _id: { $in: ids } }).select('_id').lean();
    const existingIdSet = new Set(existingBusinesses.map((business) => String(business._id)));
    const missingIds = ids.map((id) => String(id)).filter((id) => !existingIdSet.has(id));

    if (missingIds.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some business owner ids were not found.',
        invalidIds: missingIds
      });
    }

    await BusinessOwner.updateMany(
      { 'discoveryPin.isPinned': true, _id: { $nin: ids } },
      {
        $set: {
          'discoveryPin.isPinned': false,
          'discoveryPin.pinOrder': null,
          'discoveryPin.pinnedAt': null,
          'discoveryPin.pinnedBy': null
        }
      }
    );

    if (ids.length > 0) {
      const pinnedAt = new Date();
      const bulkOps = ids.map((id, index) => ({
        updateOne: {
          filter: { _id: id },
          update: {
            $set: {
              'discoveryPin.isPinned': true,
              'discoveryPin.pinOrder': index + 1,
              'discoveryPin.pinnedAt': pinnedAt,
              'discoveryPin.pinnedBy': req.admin._id
            }
          }
        }
      }));

      await BusinessOwner.bulkWrite(bulkOps);
    }

    res.status(200).json({
      success: true,
      message: 'Business discovery ranking updated successfully',
      data: {
        orderedIds: ids.map((id) => String(id)),
        count: ids.length
      }
    });
  } catch (error) {
    console.error('Update business discovery ranking error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating business discovery ranking',
      error: error.message
    });
  }
};

// ============ EVENT MANAGER MANAGEMENT ============

/**
 * Get All Event Managers with Search and Pagination
 * GET /api/admin/event-managers
 */
exports.getAllEventManagers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;

    // Build search query for users
    let userQuery = { userType: 'eventManager' };

    if (search) {
      userQuery.$or = [
        { fullName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { phoneNumber: { $regex: search, $options: 'i' } }
      ];
    }

    // Find matching user IDs first
    const matchingUsers = await User.find(userQuery).select('_id');
    const userIds = matchingUsers.map(u => u._id);

    const eventManagers = await EventManager.find({ userId: { $in: userIds } })
      .populate('userId', 'fullName email phoneNumber isActive createdAt profilePicture')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const count = await EventManager.countDocuments({ userId: { $in: userIds } });

    res.status(200).json({
      success: true,
      data: {
        eventManagers,
        totalPages: Math.ceil(count / limit),
        currentPage: parseInt(page),
        total: count
      }
    });

  } catch (error) {
    console.error('Get all event managers error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching event managers',
      error: error.message
    });
  }
};

/**
 * Get Event Manager Details
 * GET /api/admin/event-managers/:id
 */
exports.getEventManagerDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const eventManager = await EventManager.findById(id)
      .populate('userId', '-password -resetPasswordOTP -resetPasswordOTPExpires');

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        eventManager
      }
    });

  } catch (error) {
    console.error('Get event manager details error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching event manager details',
      error: error.message
    });
  }
};

/**
 * Toggle Event Manager Active Status (Block/Unblock)
 * PUT /api/admin/event-managers/:id/toggle-status
 */
exports.toggleEventManagerStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const eventManager = await EventManager.findById(id);

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager not found'
      });
    }

    // Toggle the user's isActive status
    const user = await User.findById(eventManager.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    user.isActive = !user.isActive;
    await user.save();

    res.status(200).json({
      success: true,
      message: `Event manager ${user.isActive ? 'unblocked' : 'blocked'} successfully`,
      data: {
        eventManager: {
          id: eventManager._id,
          userId: user._id,
          fullName: user.fullName,
          email: user.email,
          isActive: user.isActive
        }
      }
    });

  } catch (error) {
    console.error('Toggle event manager status error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating event manager status',
      error: error.message
    });
  }
};

/**
 * Delete Event Manager Account Permanently
 * DELETE /api/admin/event-managers/:id
 */
exports.deleteEventManager = async (req, res) => {
  try {
    const { id } = req.params;

    const eventManager = await EventManager.findById(id);

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager not found'
      });
    }

    const userId = eventManager.userId;

    // Delete ID card images from Cloudinary if they exist
    if (eventManager.idCard?.frontImage) {
      try {
        const urlParts = eventManager.idCard.frontImage.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting front ID card image:', err);
      }
    }

    if (eventManager.idCard?.backImage) {
      try {
        const urlParts = eventManager.idCard.backImage.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting back ID card image:', err);
      }
    }

    // Delete profile picture from Cloudinary if exists
    const user = await User.findById(userId);
    if (user?.profilePicture) {
      try {
        const urlParts = user.profilePicture.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (err) {
        console.error('Error deleting profile picture:', err);
      }
    }

    // Delete the event manager profile
    await EventManager.findByIdAndDelete(id);

    // Delete the user account
    await User.findByIdAndDelete(userId);

    res.status(200).json({
      success: true,
      message: 'Event manager account deleted permanently'
    });

  } catch (error) {
    console.error('Delete event manager error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting event manager',
      error: error.message
    });
  }
};

/**
 * Create or Update Settings (Terms & Conditions, Privacy Policy, etc.)
 * PUT /api/admin/settings/:key
 */
exports.updateSettings = async (req, res) => {
  try {
    const { key } = req.params;
    const { title, content } = req.body;

    // Validate key
    const validKeys = ['terms_and_conditions', 'privacy_policy', 'about_us', 'faq'];
    if (!validKeys.includes(key)) {
      return res.status(400).json({
        success: false,
        message: `Invalid settings key. Must be one of: ${validKeys.join(', ')}`
      });
    }

    // Validate required fields
    if (!title || !content) {
      return res.status(400).json({
        success: false,
        message: 'Title and content are required'
      });
    }

    // Sanitize HTML content to prevent XSS
    const sanitizedContent = sanitizeHtml(content);

    // Find and update or create
    const settings = await Settings.findOneAndUpdate(
      { key },
      {
        key,
        title,
        content: sanitizedContent,
        lastUpdatedBy: req.admin._id,
        isActive: true
      },
      {
        new: true,
        upsert: true,
        runValidators: true
      }
    );

    res.status(200).json({
      success: true,
      message: `${title} updated successfully`,
      data: {
        settings
      }
    });

  } catch (error) {
    console.error('Update settings error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while updating settings',
      error: error.message
    });
  }
};

/**
 * Get Settings by Key (Admin)
 * GET /api/admin/settings/:key
 */
exports.getSettingsByKey = async (req, res) => {
  try {
    const { key } = req.params;

    const settings = await Settings.findOne({ key })
      .populate('lastUpdatedBy', 'fullName email');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Settings not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        settings
      }
    });

  } catch (error) {
    console.error('Get settings error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching settings',
      error: error.message
    });
  }
};

/**
 * Get All Settings (Admin)
 * GET /api/admin/settings
 */
exports.getAllSettings = async (req, res) => {
  try {
    const settings = await Settings.find()
      .populate('lastUpdatedBy', 'fullName email')
      .sort({ key: 1 });

    res.status(200).json({
      success: true,
      data: {
        settings
      }
    });

  } catch (error) {
    console.error('Get all settings error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching settings',
      error: error.message
    });
  }
};

/**
 * Broadcast notification from admin to platform users
 * POST /api/admin/notifications/broadcast
 */
exports.broadcastNotification = async (req, res) => {
  try {
    const {
      title,
      body,
      userTypes = BROADCAST_USER_TYPES,
      includeInactive = false,
      sendPush = true
    } = req.body;

    if (!title || !String(title).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Title is required.'
      });
    }

    if (!body || !String(body).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Body is required.'
      });
    }

    if (!Array.isArray(userTypes) || userTypes.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'userTypes must be a non-empty array.'
      });
    }

    const normalizedUserTypes = [...new Set(userTypes.map((u) => String(u).trim()))];
    const invalidUserTypes = normalizedUserTypes.filter((u) => !BROADCAST_USER_TYPES.includes(u));
    if (invalidUserTypes.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Invalid userTypes provided.',
        invalidUserTypes
      });
    }

    const userQuery = { userType: { $in: normalizedUserTypes } };
    if (!includeInactive) {
      userQuery.isActive = true;
    }

    const users = await User.find(userQuery).select('_id userType').lean();
    if (users.length === 0) {
      return res.status(200).json({
        success: true,
        message: 'No target users found for broadcast.',
        data: {
          targetedUsers: 0,
          notificationsCreated: 0,
          push: {
            attempted: false,
            sent: 0,
            failed: 0,
            tokens: 0
          }
        }
      });
    }

    const now = new Date();
    const notificationDocs = users.map((user) => ({
      userId: user._id,
      userType: user.userType,
      title: String(title).trim(),
      body: String(body).trim(),
      type: 'admin_broadcast',
      metadata: {
        source: 'admin',
        adminId: req.admin?._id || null,
        sentAt: now
      },
      createdAt: now,
      updatedAt: now
    }));

    await Notification.insertMany(notificationDocs, { ordered: false });

    let pushSent = 0;
    let pushFailed = 0;
    let tokenCount = 0;
    const pushEnabled =
      sendPush === true &&
      firebaseAdmin &&
      firebaseAdmin.apps &&
      firebaseAdmin.apps.length > 0;

    if (pushEnabled) {
      const userIds = users.map((u) => u._id);
      const deviceTokens = await DeviceToken.find({
        userId: { $in: userIds },
        isActive: true
      }).select('token');

      const tokens = [...new Set(deviceTokens.map((t) => t.token).filter(Boolean))];
      tokenCount = tokens.length;

      const tokenBatches = chunkArray(tokens, PUSH_BATCH_SIZE);
      for (const batch of tokenBatches) {
        const response = await firebaseAdmin.messaging().sendEachForMulticast({
          tokens: batch,
          notification: {
            title: String(title).trim(),
            body: String(body).trim()
          },
          data: {
            type: 'admin_broadcast'
          }
        });

        pushSent += response.successCount;
        pushFailed += response.failureCount;
      }
    }

    return res.status(200).json({
      success: true,
      message: 'Broadcast notification sent successfully.',
      data: {
        targetedUsers: users.length,
        notificationsCreated: notificationDocs.length,
        userTypes: normalizedUserTypes,
        push: {
          attempted: pushEnabled,
          sent: pushSent,
          failed: pushFailed,
          tokens: tokenCount
        }
      }
    });
  } catch (error) {
    console.error('Broadcast notification error:', error);
    return res.status(500).json({
      success: false,
      message: 'An error occurred while broadcasting notification',
      error: error.message
    });
  }
};

/**
 * Get Public Settings (No Auth Required)
 * GET /api/settings/:key
 */
exports.getPublicSettings = async (req, res) => {
  try {
    const { key } = req.params;

    const settings = await Settings.findOne({ key, isActive: true })
      .select('key title content updatedAt');

    if (!settings) {
      return res.status(404).json({
        success: false,
        message: 'Content not found'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        settings
      }
    });

  } catch (error) {
    console.error('Get public settings error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching content',
      error: error.message
    });
  }
};
