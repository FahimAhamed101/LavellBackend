const Booking = require('../models/Booking');
const Appointment = require('../models/Appointment');
const Service = require('../models/Service');
const Provider = require('../models/Provider');
const { getStripe } = require('../utility/stripe');
const { createAndSend } = require('../utility/notificationService');

/**
 * Helper function to get provider from user
 */
const getProviderFromUser = async (userId) => {
  const provider = await Provider.findOne({ userId });
  if (!provider) {
    throw new Error('Provider profile not found');
  }
  return provider;
};

const toObjectIdString = (value) => {
  if (!value) return '';
  return value.toString();
};

const getProviderOwnershipIds = (provider) => {
  const ids = new Set();
  const providerId = toObjectIdString(provider?._id);
  const providerUserId = toObjectIdString(provider?.userId);

  if (providerId) ids.add(providerId);
  if (providerUserId) ids.add(providerUserId);

  return Array.from(ids);
};

const buildProviderOwnershipQuery = (provider) => {
  const ownerIds = getProviderOwnershipIds(provider);
  if (ownerIds.length <= 1) {
    return ownerIds[0] || toObjectIdString(provider?._id);
  }
  return { $in: ownerIds };
};

const isOwnedByProvider = (ownerId, provider) => {
  const normalizedOwner = toObjectIdString(ownerId);
  if (!normalizedOwner) return false;
  return getProviderOwnershipIds(provider).includes(normalizedOwner);
};

const hasStripeSecretConfigured = () =>
  Boolean(process.env.STRIPE_SECRET_KEY && String(process.env.STRIPE_SECRET_KEY).trim());

const isFinalPaidStatus = (paymentStatus) =>
  ['completed', 'offline_paid', 'refunded'].includes(paymentStatus);

const isBookingDownPaymentSettled = (booking) => {
  const paymentStatus = String(booking?.paymentStatus || '').toLowerCase();
  return ['authorized', 'partial', 'due_requested', 'completed', 'offline_paid', 'refunded']
    .includes(paymentStatus);
};

const normalizeBookingStatus = (status = '') =>
  String(status || '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .trim();

const normalizeAppointmentStatus = (status = '') =>
  String(status || '')
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .trim();

const getBookingFlowStatus = (booking) => {
  const bookingStatus = normalizeBookingStatus(booking?.bookingStatus || 'pending');

  if (['pending', 'cancelled', 'rejected', 'completed'].includes(bookingStatus)) {
    return bookingStatus;
  }

  if (bookingStatus === 'in_progress') {
    return 'in_progress';
  }

  if (bookingStatus === 'confirmed') {
    return isBookingDownPaymentSettled(booking) ? 'confirmed' : 'accepted';
  }

  return bookingStatus || 'pending';
};

const withBookingFlowStatus = (bookingDoc) => {
  if (!bookingDoc) return bookingDoc;
  const plain = typeof bookingDoc.toObject === 'function'
    ? bookingDoc.toObject()
    : bookingDoc;

  return {
    ...plain,
    bookingFlowStatus: getBookingFlowStatus(plain)
  };
};

const syncProviderBookingPaymentState = async (booking) => {
  if (!booking || !hasStripeSecretConfigured()) return booking;

  let stripe = null;
  try {
    stripe = getStripe();
  } catch (error) {
    console.error(
      'Stripe initialization error while syncing provider booking payment:',
      error.message || error
    );
    return booking;
  }

  let shouldSave = false;

  if (booking.paymentIntentId) {
    try {
      const intent = await stripe.paymentIntents.retrieve(booking.paymentIntentId);
      const intentStatus = (intent?.status || '').toLowerCase();

      if (intentStatus && booking.paymentIntentStatus !== intentStatus) {
        booking.paymentIntentStatus = intentStatus;
        shouldSave = true;
      }

      if (!isFinalPaidStatus(booking.paymentStatus) && booking.paymentStatus !== 'due_requested') {
        if (intentStatus === 'requires_capture') {
          if (booking.paymentStatus !== 'authorized') {
            booking.paymentStatus = 'authorized';
            shouldSave = true;
          }
        } else if (intentStatus === 'succeeded' || intentStatus === 'processing') {
          if (booking.paymentStatus !== 'partial') {
            booking.paymentStatus = 'partial';
            shouldSave = true;
          }
        } else if (
          intentStatus === 'canceled' ||
          intentStatus === 'requires_payment_method' ||
          intentStatus === 'requires_confirmation'
        ) {
          if (booking.paymentStatus !== 'pending') {
            booking.paymentStatus = 'pending';
            shouldSave = true;
          }
        }
      }
    } catch (error) {
      console.error('Stripe sync provider booking down payment error:', error.message || error);
    }
  }

  if (booking.duePaymentIntentId) {
    try {
      const dueIntent = await stripe.paymentIntents.retrieve(booking.duePaymentIntentId);
      const dueStatus = (dueIntent?.status || '').toLowerCase();

      if (dueStatus && booking.duePaymentIntentStatus !== dueStatus) {
        booking.duePaymentIntentStatus = dueStatus;
        shouldSave = true;
      }

      if (!isFinalPaidStatus(booking.paymentStatus)) {
        if (dueStatus === 'succeeded') {
          if (booking.paymentStatus !== 'completed') {
            booking.paymentStatus = 'completed';
            shouldSave = true;
          }
          if (booking.paidVia !== 'online') {
            booking.paidVia = 'online';
            shouldSave = true;
          }
          if (!booking.duePaidAt) {
            booking.duePaidAt = new Date();
            shouldSave = true;
          }
          if (booking.remainingAmount !== 0) {
            booking.remainingAmount = 0;
            shouldSave = true;
          }
        } else if (
          dueStatus === 'processing' ||
          dueStatus === 'canceled' ||
          dueStatus === 'requires_payment_method' ||
          dueStatus === 'requires_confirmation'
        ) {
          if (booking.paymentStatus !== 'due_requested') {
            booking.paymentStatus = 'due_requested';
            shouldSave = true;
          }
        }
      }
    } catch (error) {
      console.error('Stripe sync provider booking due payment error:', error.message || error);
    }
  }

  if (shouldSave) {
    await booking.save();
  }

  return booking;
};

const syncProviderAppointmentPaymentState = async (appointment) => {
  if (!appointment || !hasStripeSecretConfigured() || !appointment.paymentIntentId) {
    return appointment;
  }

  let stripe = null;
  try {
    stripe = getStripe();
  } catch (error) {
    console.error(
      'Stripe initialization error while syncing provider appointment payment:',
      error.message || error
    );
    return appointment;
  }

  try {
    const intent = await stripe.paymentIntents.retrieve(appointment.paymentIntentId);
    const intentStatus = (intent?.status || '').toLowerCase();
    let shouldSave = false;

    if (intentStatus && appointment.paymentIntentStatus !== intentStatus) {
      appointment.paymentIntentStatus = intentStatus;
      shouldSave = true;
    }

    if (intentStatus === 'succeeded') {
      if (!isFinalPaidStatus(appointment.paymentStatus) || appointment.paymentStatus === 'completed') {
        if (appointment.paymentStatus !== 'completed') {
          appointment.paymentStatus = 'completed';
          shouldSave = true;
        }
        if (appointment.paidVia !== 'online') {
          appointment.paidVia = 'online';
          shouldSave = true;
        }
        if (!appointment.paidAt) {
          appointment.paidAt = new Date();
          shouldSave = true;
        }
        if (appointment.remainingAmount !== 0) {
          appointment.remainingAmount = 0;
          shouldSave = true;
        }
      }
    } else if (
      intentStatus === 'processing' ||
      intentStatus === 'requires_capture' ||
      intentStatus === 'canceled' ||
      intentStatus === 'requires_payment_method' ||
      intentStatus === 'requires_confirmation'
    ) {
      if (!['offline_paid', 'refunded'].includes(appointment.paymentStatus)) {
        if (appointment.paymentStatus !== 'pending') {
          appointment.paymentStatus = 'pending';
          shouldSave = true;
        }
        if (appointment.paidVia !== null) {
          appointment.paidVia = null;
          shouldSave = true;
        }
        if (appointment.paidAt !== null) {
          appointment.paidAt = null;
          shouldSave = true;
        }
        const remaining = Math.max(
          Number(appointment.totalAmount || 0) - Number(appointment.downPayment || 0),
          0
        );
        if (appointment.remainingAmount !== remaining) {
          appointment.remainingAmount = remaining;
          shouldSave = true;
        }
      }
    }

    if (shouldSave) {
      await appointment.save();
    }
  } catch (error) {
    console.error(
      'Stripe sync provider appointment payment error:',
      error.message || error
    );
  }

  return appointment;
};

// ==================== BOOKING MANAGEMENT ====================

/**
 * @desc    Get all bookings for provider's services
 * @route   GET /api/providers/bookings
 * @access  Private (Provider)
 */
exports.getProviderBookings = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);
    const { status } = req.query;
    const hasPageQuery = req.query.page !== undefined;
    const hasLimitQuery = req.query.limit !== undefined;
    const shouldPaginate = hasPageQuery || hasLimitQuery;
    const pageNum = shouldPaginate
      ? Math.max(parseInt(req.query.page, 10) || 1, 1)
      : 1;
    const limitNum = shouldPaginate
      ? Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100)
      : Number.MAX_SAFE_INTEGER;
    const requestedStatus = normalizeBookingStatus(status);
    const effectiveStatus = requestedStatus;

    const query = { providerId: buildProviderOwnershipQuery(provider) };
    if (
      effectiveStatus &&
      !['accepted', 'confirmed'].includes(effectiveStatus)
    ) {
      query.bookingStatus = effectiveStatus;
    } else if (effectiveStatus === 'accepted' || effectiveStatus === 'confirmed') {
      query.bookingStatus = { $in: ['confirmed', 'in_progress'] };
    }

    const bookingsRaw = await Booking.find(query)
      .populate('user', 'fullName email phoneNumber profilePicture location')
      .populate('service')
      .sort({ createdAt: -1 });

    await Promise.all(bookingsRaw.map((booking) => syncProviderBookingPaymentState(booking)));

    const bookingsWithFlow = bookingsRaw.map(withBookingFlowStatus).map((booking) => {
      if (booking.user && booking.user.location) {
        booking.user.address = booking.user.location.address || '';
      }
      return booking;
    });

    const filteredBookings = effectiveStatus
      ? bookingsWithFlow.filter((item) => item.bookingFlowStatus === effectiveStatus)
      : bookingsWithFlow;

    const total = filteredBookings.length;
    const skip = shouldPaginate ? (pageNum - 1) * limitNum : 0;
    const bookings = shouldPaginate
      ? filteredBookings.slice(skip, skip + limitNum)
      : filteredBookings;

    res.status(200).json({
      success: true,
      count: bookings.length,
      total,
      currentPage: pageNum,
      totalPages: shouldPaginate ? Math.ceil(total / limitNum) : 1,
      data: bookings
    });

  } catch (error) {
    console.error('Get provider bookings error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching bookings'
    });
  }
};

/**
 * @desc    Get provider transaction history (bookings + appointments)
 * @route   GET /api/providers/bookings/transactions
 * @access  Private (Provider)
 * @query   status, source(all|booking|appointment), page, limit, search, from, to
 */
exports.getProviderTransactions = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);
    const providerOwnershipQuery = buildProviderOwnershipQuery(provider);
    const {
      status,
      source = 'all',
      page = 1,
      limit = 20,
      search,
      from,
      to
    } = req.query;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

    const createdAt = {};
    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) createdAt.$gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) createdAt.$lte = toDate;
    }

    const dateQuery = Object.keys(createdAt).length ? { createdAt } : {};
    const paymentStatusQuery = status ? { paymentStatus: status } : {};
    const searchText = typeof search === 'string' ? search.trim() : '';
    const searchRegex = searchText ? new RegExp(searchText, 'i') : null;

    const includeBookings = source === 'all' || source === 'booking';
    const includeAppointments = source === 'all' || source === 'appointment';

    const transactions = [];

    if (includeBookings) {
      const bookings = await Booking.find({
        providerId: providerOwnershipQuery,
        ...dateQuery,
        ...paymentStatusQuery
      })
        .populate('userId', 'fullName')
        .sort({ createdAt: -1 });
      await Promise.all(bookings.map((booking) => syncProviderBookingPaymentState(booking)));

      for (const booking of bookings) {
        const customerName = booking.userId?.fullName || null;
        const serviceName = booking.serviceSnapshot?.serviceName || null;

        if (
          searchRegex &&
          !searchRegex.test(customerName || '') &&
          !searchRegex.test(serviceName || '')
        ) {
          continue;
        }

        transactions.push({
          source: 'booking',
          orderId: booking._id,
          transactionId: booking.paymentIntentId || booking.duePaymentIntentId || booking.checkoutSessionId || null,
          paymentIntentId: booking.paymentIntentId || null,
          duePaymentIntentId: booking.duePaymentIntentId || null,
          checkoutSessionId: booking.checkoutSessionId || null,
          customerName,
          serviceName,
          bookingDate: booking.bookingDate || null,
          amount: booking.totalAmount,
          downPayment: booking.downPayment,
          dueAmount: booking.dueAmount,
          remainingAmount: booking.remainingAmount,
          paymentStatus: booking.paymentStatus,
          paymentIntentStatus: booking.paymentIntentStatus,
          duePaymentIntentStatus: booking.duePaymentIntentStatus,
          paidVia: booking.paidVia,
          status: booking.bookingStatus,
          paidAt: booking.duePaidAt || booking.offlinePaidAt || null,
          createdAt: booking.createdAt
        });
      }
    }

    if (includeAppointments) {
      const appointments = await Appointment.find({
        providerId: providerOwnershipQuery,
        ...dateQuery,
        ...paymentStatusQuery
      })
        .populate('userId', 'fullName')
        .sort({ createdAt: -1 });
      await Promise.all(
        appointments.map((appointment) => syncProviderAppointmentPaymentState(appointment))
      );

      for (const appointment of appointments) {
        const customerName = appointment.userId?.fullName || null;
        const serviceName = appointment.serviceSnapshot?.serviceName || null;

        if (
          searchRegex &&
          !searchRegex.test(customerName || '') &&
          !searchRegex.test(serviceName || '')
        ) {
          continue;
        }

        transactions.push({
          source: 'appointment',
          orderId: appointment._id,
          transactionId: appointment.paymentIntentId || appointment.checkoutSessionId || null,
          paymentIntentId: appointment.paymentIntentId || null,
          duePaymentIntentId: null,
          checkoutSessionId: appointment.checkoutSessionId || null,
          customerName,
          serviceName,
          bookingDate: appointment.appointmentDate || null,
          amount: appointment.totalAmount,
          downPayment: appointment.downPayment,
          dueAmount: 0,
          remainingAmount: appointment.remainingAmount,
          paymentStatus: appointment.paymentStatus,
          paymentIntentStatus: appointment.paymentIntentStatus,
          duePaymentIntentStatus: null,
          paidVia: appointment.paidVia,
          status: appointment.appointmentStatus,
          paidAt: appointment.paidAt || null,
          createdAt: appointment.createdAt
        });
      }
    }

    transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    const total = transactions.length;
    const totalPages = Math.ceil(total / limitNum);
    const start = (pageNum - 1) * limitNum;
    const pageData = transactions.slice(start, start + limitNum);

    res.status(200).json({
      success: true,
      data: {
        transactions: pageData,
        total,
        currentPage: pageNum,
        totalPages,
        filters: {
          status: status || null,
          source,
          search: searchText || null,
          from: from || null,
          to: to || null
        }
      }
    });
  } catch (error) {
    console.error('Get provider transactions error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching provider transactions'
    });
  }
};

/**
 * @desc    Get single booking details
 * @route   GET /api/providers/bookings/:id
 * @access  Private (Provider)
 */
exports.getBookingDetails = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);

    const booking = await Booking.findById(req.params.id)
      .populate('user', 'fullName email phoneNumber profilePicture')
      .populate('service');

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking belongs to this provider
    if (!isOwnedByProvider(booking.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this booking'
      });
    }

    await syncProviderBookingPaymentState(booking);

    res.status(200).json({
      success: true,
      data: withBookingFlowStatus(booking)
    });

  } catch (error) {
    console.error('Get booking details error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching booking details'
    });
  }
};

/**
 * @desc    Accept/Confirm a booking request
 * @route   PATCH /api/providers/bookings/:id/accept
 * @access  Private (Provider)
 */
exports.acceptBooking = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);
    const { providerNotes } = req.body;

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking belongs to this provider
    if (!isOwnedByProvider(booking.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this booking'
      });
    }

    // Check if booking is in pending status
    if (booking.bookingStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot accept a ${booking.bookingStatus} booking`
      });
    }

    let clientSecret = null;
    let paymentIntent = null;
    try {
      const stripe = getStripe();
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(booking.downPayment * 100),
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
          bookingId: booking._id.toString(),
          userId: booking.userId.toString(),
          providerId: booking.providerId.toString(),
          type: 'booking_down_payment'
        }
      });
    } catch (stripeError) {
      console.error('Stripe checkout session error:', stripeError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create payment intent',
        error: stripeError.message
      });
    }

    // Confirm booking only after payment intent is ready.
    booking.bookingStatus = 'confirmed';
    if (providerNotes) {
      booking.providerNotes = providerNotes;
    }
    booking.paymentIntentId = paymentIntent.id;
    booking.paymentIntentStatus = paymentIntent.status;
    if (!['completed', 'offline_paid', 'refunded'].includes(booking.paymentStatus)) {
      booking.paymentStatus = 'pending';
    }
    await booking.save();

    clientSecret = paymentIntent.client_secret;

    // Populate for response
    await booking.populate('user', 'fullName email phoneNumber profilePicture');

    res.status(200).json({
      success: true,
      message: 'Booking accepted successfully',
      data: {
        booking,
        checkout: { clientSecret }
      }
    });

    await createAndSend({
      userId: booking.userId,
      userType: 'user',
      title: 'Booking accepted',
      body: 'Your booking was accepted. Please complete the down payment.',
      type: 'booking_payment',
      entityType: 'booking',
      entityId: booking._id,
      data: {
        bookingId: booking._id.toString()
      }
    });

  } catch (error) {
    console.error('Accept booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error accepting booking'
    });
  }
};

/**
 * @desc    Reject/Cancel a booking request
 * @route   PATCH /api/providers/bookings/:id/reject
 * @access  Private (Provider)
 */
exports.rejectBooking = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);
    const { cancellationReason } = req.body;

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking belongs to this provider
    if (!isOwnedByProvider(booking.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this booking'
      });
    }

    // Check if booking can be rejected
    if (['completed', 'cancelled', 'rejected'].includes(booking.bookingStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reject a ${booking.bookingStatus} booking`
      });
    }

    // Update booking status
    booking.bookingStatus = 'rejected';
    booking.cancellationReason = cancellationReason || 'Rejected by provider';
    booking.cancelledBy = 'provider';
    booking.cancelledAt = new Date();

    if (booking.paymentIntentId) {
      try {
        const stripe = getStripe();
        await stripe.paymentIntents.cancel(booking.paymentIntentId);
        booking.paymentIntentStatus = 'canceled';
      } catch (stripeError) {
        console.error('Stripe cancel error:', stripeError);
      }
    }
    await booking.save();

    // Populate for response
    await booking.populate('user', 'fullName email phoneNumber profilePicture');

    res.status(200).json({
      success: true,
      message: 'Booking rejected successfully',
      data: booking
    });

  } catch (error) {
    console.error('Reject booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error rejecting booking'
    });
  }
};

/**
 * @desc    Mark booking as in progress
 * @route   PATCH /api/providers/bookings/:id/start
 * @access  Private (Provider)
 */
exports.startBooking = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking belongs to this provider
    if (!isOwnedByProvider(booking.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this booking'
      });
    }

    await syncProviderBookingPaymentState(booking);

    if (!isBookingDownPaymentSettled(booking)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot start booking before down payment is completed'
      });
    }

    // Check if booking is confirmed
    if (booking.bookingStatus !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Cannot start a ${booking.bookingStatus} booking. Must be confirmed first.`
      });
    }

    booking.bookingStatus = 'in_progress';
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Booking started',
      data: booking
    });

  } catch (error) {
    console.error('Start booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error starting booking'
    });
  }
};

/**
 * @desc    Mark booking as completed
 * @route   PATCH /api/providers/bookings/:id/complete
 * @access  Private (Provider)
 */
exports.completeBooking = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);

    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    // Check if booking belongs to this provider
    if (!isOwnedByProvider(booking.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this booking'
      });
    }

    await syncProviderBookingPaymentState(booking);

    if (!isBookingDownPaymentSettled(booking)) {
      return res.status(400).json({
        success: false,
        message: 'Cannot complete booking before down payment is completed'
      });
    }

    // Check if booking can be completed
    if (!['confirmed', 'in_progress'].includes(booking.bookingStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot complete a ${booking.bookingStatus} booking`
      });
    }

    booking.bookingStatus = 'completed';
    booking.completedAt = new Date();
    await booking.save();

    // Update provider's completed jobs count
    provider.completedJobs += 1;
    await provider.save();

    res.status(200).json({
      success: true,
      message: 'Booking completed successfully',
      data: booking
    });

  } catch (error) {
    console.error('Complete booking error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error completing booking'
    });
  }
};

// ==================== APPOINTMENT MANAGEMENT ====================

/**
 * @desc    Get all appointments for provider's services
 * @route   GET /api/providers/appointments
 * @access  Private (Provider)
 */
exports.getProviderAppointments = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);
    const { status, date } = req.query;
    const hasPageQuery = req.query.page !== undefined;
    const hasLimitQuery = req.query.limit !== undefined;
    const shouldPaginate = hasPageQuery || hasLimitQuery;
    const pageNum = shouldPaginate
      ? Math.max(parseInt(req.query.page, 10) || 1, 1)
      : 1;
    const limitNum = shouldPaginate
      ? Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 100)
      : Number.MAX_SAFE_INTEGER;

    // Build query
    const query = { providerId: buildProviderOwnershipQuery(provider) };
    if (status) {
      const normalizedStatus = normalizeAppointmentStatus(status);
      if (normalizedStatus === 'accepted') {
        query.appointmentStatus = 'confirmed';
      } else {
        query.appointmentStatus = normalizedStatus;
      }
    }
    if (date) {
      const appointmentDate = new Date(date);
      query.appointmentDate = {
        $gte: new Date(appointmentDate.setHours(0, 0, 0, 0)),
        $lt: new Date(appointmentDate.setHours(23, 59, 59, 999))
      };
    }

    // Pagination
    const skip = shouldPaginate ? (pageNum - 1) * limitNum : 0;

    let appointmentsQuery = Appointment.find(query)
      .select('-downPayment')
      .populate('user', 'fullName email phoneNumber profilePicture location')
      .populate('service')
      .sort({ appointmentDate: 1, 'timeSlot.startTime': 1 });

    if (shouldPaginate) {
      appointmentsQuery = appointmentsQuery.skip(skip).limit(limitNum);
    }

    const appointments = await appointmentsQuery;
    await Promise.all(
      appointments.map((appointment) => syncProviderAppointmentPaymentState(appointment))
    );

    const total = await Appointment.countDocuments(query);

    const appointmentsWithAddress = appointments.map((appointment) => {
      const obj = appointment.toObject ? appointment.toObject() : appointment;
      if (obj.user && obj.user.location) {
        obj.user.address = obj.user.location.address || '';
      }
      return obj;
    });

    res.status(200).json({
      success: true,
      count: appointmentsWithAddress.length,
      total,
      currentPage: pageNum,
      totalPages: shouldPaginate ? Math.ceil(total / limitNum) : 1,
      data: appointmentsWithAddress
    });

  } catch (error) {
    console.error('Get provider appointments error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching appointments'
    });
  }
};

/**
 * @desc    Get single appointment details
 * @route   GET /api/providers/appointments/:id
 * @access  Private (Provider)
 */
exports.getAppointmentDetails = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);

    const appointment = await Appointment.findById(req.params.id)
      .select('-downPayment')
      .populate('user', 'fullName email phoneNumber profilePicture')
      .populate('service');

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check if appointment belongs to this provider
    if (!isOwnedByProvider(appointment.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to view this appointment'
      });
    }

    await syncProviderAppointmentPaymentState(appointment);

    res.status(200).json({
      success: true,
      data: appointment
    });

  } catch (error) {
    console.error('Get appointment details error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching appointment details'
    });
  }
};

/**
 * @desc    Accept/Confirm an appointment request
 * @route   PATCH /api/providers/appointments/:id/accept
 * @access  Private (Provider)
 */
exports.acceptAppointment = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);
    const { providerNotes } = req.body;

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check if appointment belongs to this provider
    if (!isOwnedByProvider(appointment.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this appointment'
      });
    }

    // Check if appointment is in pending status
    if (appointment.appointmentStatus !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Cannot accept a ${appointment.appointmentStatus} appointment`
      });
    }

    const totalAmount = appointment.totalAmount;
    const platformFee = Math.round(totalAmount * 0.1 * 100) / 100;
    const providerPayoutFromPayment = Math.max(totalAmount - platformFee, 0);
    let paymentIntent = null;
    try {
      const stripe = getStripe();
      paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(totalAmount * 100),
        currency: 'usd',
        automatic_payment_methods: { enabled: true },
        metadata: {
          appointmentId: appointment._id.toString(),
          userId: appointment.userId.toString(),
          providerId: appointment.providerId.toString(),
          type: 'appointment_full_payment'
        }
      });
    } catch (stripeError) {
      console.error('Stripe checkout session error:', stripeError);
      return res.status(500).json({
        success: false,
        message: 'Failed to create payment intent',
        error: stripeError.message
      });
    }

    appointment.appointmentStatus = 'confirmed';
    if (providerNotes) {
      appointment.providerNotes = providerNotes;
    }
    appointment.platformFee = platformFee;
    appointment.providerPayoutFromPayment = providerPayoutFromPayment;
    appointment.paymentIntentId = paymentIntent.id;
    appointment.paymentIntentStatus = paymentIntent.status;
    await appointment.save();

    const clientSecret = paymentIntent.client_secret;

    // Populate for response
    await appointment.populate('user', 'fullName email phoneNumber profilePicture');

    res.status(200).json({
      success: true,
      message: 'Appointment accepted successfully',
      data: {
        appointment,
        checkout: { clientSecret }
      }
    });

    await createAndSend({
      userId: appointment.userId,
      userType: 'user',
      title: 'Appointment accepted',
      body: 'Your appointment was accepted. Please complete the payment.',
      type: 'appointment_payment',
      entityType: 'appointment',
      entityId: appointment._id,
      data: {
        appointmentId: appointment._id.toString()
      }
    });

  } catch (error) {
    console.error('Accept appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error accepting appointment'
    });
  }
};

/**
 * @desc    Reject/Cancel an appointment request
 * @route   PATCH /api/providers/appointments/:id/reject
 * @access  Private (Provider)
 */
exports.rejectAppointment = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);
    const { cancellationReason } = req.body;

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check if appointment belongs to this provider
    if (!isOwnedByProvider(appointment.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this appointment'
      });
    }

    // Check if appointment can be rejected
    if (['completed', 'cancelled', 'rejected'].includes(appointment.appointmentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reject a ${appointment.appointmentStatus} appointment`
      });
    }

    // Update appointment status
    appointment.appointmentStatus = 'rejected';
    appointment.cancellationReason = cancellationReason || 'Rejected by provider';
    appointment.cancelledBy = 'provider';
    appointment.cancelledAt = new Date();
    await appointment.save();

    // Populate for response
    await appointment.populate('user', 'fullName email phoneNumber profilePicture');

    res.status(200).json({
      success: true,
      message: 'Appointment rejected successfully',
      data: appointment
    });

  } catch (error) {
    console.error('Reject appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error rejecting appointment'
    });
  }
};

/**
 * @desc    Reschedule an appointment
 * @route   PATCH /api/providers/appointments/:id/reschedule
 * @access  Private (Provider)
 */
exports.rescheduleAppointment = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);
    const { appointmentDate, timeSlot, providerNotes } = req.body;

    // Validate required fields
    if (!appointmentDate || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: 'Please provide appointmentDate and timeSlot'
      });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check if appointment belongs to this provider
    if (!isOwnedByProvider(appointment.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this appointment'
      });
    }

    // Check if appointment can be rescheduled
    if (['completed', 'cancelled', 'rejected', 'no_show'].includes(appointment.appointmentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reschedule a ${appointment.appointmentStatus} appointment`
      });
    }

    // Store old values for reference
    const oldDate = appointment.appointmentDate;
    const oldTimeSlot = { ...appointment.timeSlot };

    // Update appointment with new schedule
    appointment.appointmentDate = new Date(appointmentDate);
    appointment.timeSlot = {
      startTime: timeSlot.startTime,
      endTime: timeSlot.endTime
    };

    // Check for time conflicts with the new schedule
    const hasConflict = await appointment.hasTimeConflict();
    if (hasConflict) {
      return res.status(409).json({
        success: false,
        message: 'The new time slot conflicts with another appointment. Please choose a different time.'
      });
    }

    // Add provider notes about rescheduling
    const rescheduleNote = `Rescheduled by provider from ${oldDate.toLocaleDateString()} (${oldTimeSlot.startTime}-${oldTimeSlot.endTime}) to ${appointment.appointmentDate.toLocaleDateString()} (${timeSlot.startTime}-${timeSlot.endTime})`;
    appointment.providerNotes = providerNotes
      ? `${providerNotes}\n\n${rescheduleNote}`
      : rescheduleNote;

    // Keep status as confirmed if it was, otherwise set to pending for user review
    if (appointment.appointmentStatus === 'pending') {
      appointment.appointmentStatus = 'pending';
    }

    await appointment.save();

    // Populate for response
    await appointment.populate('user', 'fullName email phoneNumber profilePicture');

    res.status(200).json({
      success: true,
      message: 'Appointment rescheduled successfully',
      data: appointment
    });

  } catch (error) {
    console.error('Reschedule appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error rescheduling appointment'
    });
  }
};

/**
 * @desc    Mark appointment as in progress
 * @route   PATCH /api/providers/appointments/:id/start
 * @access  Private (Provider)
 */
exports.startAppointment = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check if appointment belongs to this provider
    if (!isOwnedByProvider(appointment.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this appointment'
      });
    }

    // Check if appointment is confirmed
    if (appointment.appointmentStatus !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Cannot start a ${appointment.appointmentStatus} appointment. Must be confirmed first.`
      });
    }

    appointment.appointmentStatus = 'in_progress';
    await appointment.save();

    res.status(200).json({
      success: true,
      message: 'Appointment started',
      data: appointment
    });

  } catch (error) {
    console.error('Start appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error starting appointment'
    });
  }
};

/**
 * @desc    Mark appointment as completed
 * @route   PATCH /api/providers/appointments/:id/complete
 * @access  Private (Provider)
 */
exports.completeAppointment = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check if appointment belongs to this provider
    if (!isOwnedByProvider(appointment.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this appointment'
      });
    }

    // Check if appointment can be completed
    if (!['confirmed', 'in_progress'].includes(appointment.appointmentStatus)) {
      return res.status(400).json({
        success: false,
        message: `Cannot complete a ${appointment.appointmentStatus} appointment`
      });
    }

    appointment.appointmentStatus = 'completed';
    appointment.completedAt = new Date();
    await appointment.save();

    // Update provider's completed jobs count
    provider.completedJobs += 1;
    await provider.save();

    res.status(200).json({
      success: true,
      message: 'Appointment completed successfully',
      data: appointment
    });

  } catch (error) {
    console.error('Complete appointment error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error completing appointment'
    });
  }
};

/**
 * @desc    Mark user as no-show for appointment
 * @route   PATCH /api/providers/appointments/:id/no-show
 * @access  Private (Provider)
 */
exports.markNoShow = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found'
      });
    }

    // Check if appointment belongs to this provider
    if (!isOwnedByProvider(appointment.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to manage this appointment'
      });
    }

    // Check if appointment was confirmed
    if (appointment.appointmentStatus !== 'confirmed') {
      return res.status(400).json({
        success: false,
        message: `Cannot mark no-show for a ${appointment.appointmentStatus} appointment`
      });
    }

    appointment.appointmentStatus = 'no_show';
    await appointment.save();

    res.status(200).json({
      success: true,
      message: 'Appointment marked as no-show',
      data: appointment
    });

  } catch (error) {
    console.error('Mark no-show error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error marking no-show'
    });
  }
};

/**
 * @desc    Get provider's booking/appointment statistics
 * @route   GET /api/providers/stats
 * @access  Private (Provider)
 */
exports.getProviderStats = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);
    const providerOwnershipQuery = buildProviderOwnershipQuery(provider);

    // Get booking stats
    const bookingStats = await Booking.aggregate([
      { $match: { providerId: providerOwnershipQuery } },
      {
        $group: {
          _id: '$bookingStatus',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);

    // Get appointment stats
    const appointmentStats = await Appointment.aggregate([
      { $match: { providerId: providerOwnershipQuery } },
      {
        $group: {
          _id: '$appointmentStatus',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' }
        }
      }
    ]);

    // Get today's appointments
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const todayAppointments = await Appointment.countDocuments({
      providerId: providerOwnershipQuery,
      appointmentDate: { $gte: today, $lt: tomorrow },
      appointmentStatus: { $in: ['pending', 'confirmed'] }
    });

    // Get pending requests
    const pendingBookings = await Booking.countDocuments({
      providerId: providerOwnershipQuery,
      bookingStatus: 'pending'
    });

    const pendingAppointments = await Appointment.countDocuments({
      providerId: providerOwnershipQuery,
      appointmentStatus: 'pending'
    });

    // Month range for stats
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    const startOfNextMonth = new Date(startOfMonth);
    startOfNextMonth.setMonth(startOfNextMonth.getMonth() + 1);

    // Total orders (bookings + appointments)
    const totalBookingsCount = await Booking.countDocuments({ providerId: providerOwnershipQuery });
    const totalAppointmentsCount = await Appointment.countDocuments({
      providerId: providerOwnershipQuery
    });

    const completedBookingsCount = await Booking.countDocuments({
      providerId: providerOwnershipQuery,
      bookingStatus: 'completed'
    });
    const completedAppointmentsCount = await Appointment.countDocuments({
      providerId: providerOwnershipQuery,
      appointmentStatus: 'completed'
    });

    const cancelledBookingsCount = await Booking.countDocuments({
      providerId: providerOwnershipQuery,
      bookingStatus: 'cancelled'
    });
    const cancelledAppointmentsCount = await Appointment.countDocuments({
      providerId: providerOwnershipQuery,
      appointmentStatus: 'cancelled'
    });

    const monthlyBookingsCount = await Booking.countDocuments({
      providerId: providerOwnershipQuery,
      createdAt: { $gte: startOfMonth, $lt: startOfNextMonth }
    });
    const monthlyAppointmentsCount = await Appointment.countDocuments({
      providerId: providerOwnershipQuery,
      createdAt: { $gte: startOfMonth, $lt: startOfNextMonth }
    });

    // Income (completed or offline paid)
    const paymentMatch = { $in: ['completed', 'offline_paid'] };

    const totalBookingIncome = await Booking.aggregate([
      { $match: { providerId: providerOwnershipQuery, paymentStatus: paymentMatch } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    const totalAppointmentIncome = await Appointment.aggregate([
      { $match: { providerId: providerOwnershipQuery, paymentStatus: paymentMatch } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    const monthlyBookingIncome = await Booking.aggregate([
      {
        $match: {
          providerId: providerOwnershipQuery,
          paymentStatus: paymentMatch,
          createdAt: { $gte: startOfMonth, $lt: startOfNextMonth }
        }
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);
    const monthlyAppointmentIncome = await Appointment.aggregate([
      {
        $match: {
          providerId: providerOwnershipQuery,
          paymentStatus: paymentMatch,
          createdAt: { $gte: startOfMonth, $lt: startOfNextMonth }
        }
      },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        profileStats: {
          myOrders: {
            total: totalBookingsCount + totalAppointmentsCount,
            thisMonth: monthlyBookingsCount + monthlyAppointmentsCount
          },
          totalIncome: {
            total:
              (totalBookingIncome[0]?.total || 0) +
              (totalAppointmentIncome[0]?.total || 0),
            thisMonth:
              (monthlyBookingIncome[0]?.total || 0) +
              (monthlyAppointmentIncome[0]?.total || 0)
          }
        },
        homeStats: {
          totalServiceAndAppointmentBooking: totalBookingsCount + totalAppointmentsCount,
          completedServiceAndAppointmentBooking: completedBookingsCount + completedAppointmentsCount,
          cancelledServiceAndAppointmentBooking: cancelledBookingsCount + cancelledAppointmentsCount
        },
        bookingStats,
        appointmentStats,
        todayAppointments,
        pendingRequests: {
          bookings: pendingBookings,
          appointments: pendingAppointments,
          total: pendingBookings + pendingAppointments
        },
        orders: {
          total: totalBookingsCount + totalAppointmentsCount,
          thisMonth: monthlyBookingsCount + monthlyAppointmentsCount
        },
        income: {
          total:
            (totalBookingIncome[0]?.total || 0) +
            (totalAppointmentIncome[0]?.total || 0),
          thisMonth:
            (monthlyBookingIncome[0]?.total || 0) +
            (monthlyAppointmentIncome[0]?.total || 0)
        },
        completedJobs: provider.completedJobs,
        rating: provider.rating,
        totalReviews: provider.totalReviews
      }
    });

  } catch (error) {
    console.error('Get provider stats error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Error fetching statistics'
    });
  }
};

/**
 * @desc    Request due payment for a completed booking (provider)
 * @route   POST /api/providers/bookings/:id/request-due
 * @access  Private (Provider)
 */
exports.requestDuePayment = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (!isOwnedByProvider(booking.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    await syncProviderBookingPaymentState(booking);

    if (booking.bookingStatus !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Booking must be completed to request due payment'
      });
    }

    if (booking.paymentStatus === 'completed' || booking.paymentStatus === 'offline_paid') {
      return res.status(400).json({
        success: false,
        message: 'Booking already paid'
      });
    }

    if (booking.paymentStatus === 'due_requested' && booking.duePaymentIntentId) {
      return res.status(400).json({
        success: false,
        message: 'Due payment already requested'
      });
    }

    const downPaymentSettled =
      booking.paymentStatus === 'authorized' ||
      booking.paymentStatus === 'partial';
    if (!downPaymentSettled) {
      return res.status(400).json({
        success: false,
        message: 'Down payment must be completed before requesting due payment'
      });
    }

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(booking.dueAmount * 100),
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        bookingId: booking._id.toString(),
        userId: booking.userId.toString(),
        providerId: booking.providerId.toString(),
        type: 'booking_due_payment'
      }
    });

    booking.duePaymentIntentId = paymentIntent.id;
    booking.duePaymentIntentStatus = paymentIntent.status;
    booking.paymentStatus = 'due_requested';
    booking.dueRequestedAt = new Date();
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Due payment requested',
      data: {
        bookingId: booking._id,
        dueAmount: booking.dueAmount,
        clientSecret: paymentIntent.client_secret
      }
    });
  } catch (error) {
    console.error('Request due payment error:', error);
    res.status(500).json({
      success: false,
      message: 'Error requesting due payment',
      error: error.message
    });
  }
};

/**
 * @desc    Mark due payment as paid offline (provider)
 * @route   POST /api/providers/bookings/:id/mark-offline-paid
 * @access  Private (Provider)
 */
exports.markOfflinePaid = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (!isOwnedByProvider(booking.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    if (booking.bookingStatus !== 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Booking must be completed to mark offline payment'
      });
    }

    booking.paymentStatus = 'offline_paid';
    booking.paidVia = 'offline';
    booking.offlinePaidAt = new Date();
    booking.remainingAmount = 0;
    await booking.save();

    res.status(200).json({
      success: true,
      message: 'Marked as paid offline',
      data: booking
    });
  } catch (error) {
    console.error('Mark offline paid error:', error);
    res.status(500).json({
      success: false,
      message: 'Error marking offline payment',
      error: error.message
    });
  }
};

/**
 * @desc    Get payment status for a booking (provider)
 * @route   GET /api/providers/bookings/:id/payment-status
 * @access  Private (Provider)
 */
exports.getProviderBookingPaymentStatus = async (req, res) => {
  try {
    const provider = await getProviderFromUser(req.user._id);
    const booking = await Booking.findById(req.params.id);

    if (!booking) {
      return res.status(404).json({
        success: false,
        message: 'Booking not found'
      });
    }

    if (!isOwnedByProvider(booking.providerId, provider)) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    await syncProviderBookingPaymentState(booking);

    res.status(200).json({
      success: true,
      data: {
        bookingId: booking._id,
        bookingStatus: booking.bookingStatus,
        paymentStatus: booking.paymentStatus,
        paymentIntentStatus: booking.paymentIntentStatus,
        duePaymentIntentStatus: booking.duePaymentIntentStatus,
        paidVia: booking.paidVia,
        totalAmount: booking.totalAmount,
        downPayment: booking.downPayment,
        dueAmount: booking.dueAmount,
        remainingAmount: booking.remainingAmount,
        dueRequestedAt: booking.dueRequestedAt,
        duePaidAt: booking.duePaidAt,
        offlinePaidAt: booking.offlinePaidAt
      }
    });
  } catch (error) {
    console.error('Get provider booking payment status error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching payment status',
      error: error.message
    });
  }
};
