const Event = require('../models/Event');
const EventManager = require('../models/EventManager');
const EventTicketPurchase = require('../models/EventTicketPurchase');
const { uploadToCloudinary, deleteFromCloudinary } = require('../utility/cloudinary');
const fs = require('fs').promises;

/**
 * Create a new event (draft)
 * POST /api/event-managers/events
 */
exports.createEvent = async (req, res) => {
  try {
    const {
      eventName,
      eventType,
      eventManagerName,
      eventLocation,
      ticketSalesStartDate,
      ticketSalesEndDate,
      eventStartDateTime,
      eventEndDateTime,
      ticketPrice,
      maximumNumberOfTickets,
      confirmationCodePrefix,
      eventDescription
    } = req.body;

    // Get event manager ID from authenticated user
    const eventManager = await EventManager.findOne({ userId: req.user._id });

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    // Handle event image upload if provided
    let eventImageUrl = null;
    if (req.file) {
      const uploadResult = await uploadToCloudinary(req.file.path, 'events');
      if (uploadResult.success) {
        eventImageUrl = uploadResult.url;
      }
      // Delete local file after upload
      await fs.unlink(req.file.path).catch(() => {});
    }

    // Create event
    const event = new Event({
      eventManagerId: eventManager._id,
      eventImage: eventImageUrl,
      eventName,
      eventType,
      eventManagerName,
      eventLocation,
      ticketSalesStartDate: new Date(ticketSalesStartDate),
      ticketSalesEndDate: new Date(ticketSalesEndDate),
      eventStartDateTime: new Date(eventStartDateTime),
      eventEndDateTime: new Date(eventEndDateTime),
      ticketPrice: parseFloat(ticketPrice),
      maximumNumberOfTickets: parseInt(maximumNumberOfTickets),
      confirmationCodePrefix: confirmationCodePrefix.toUpperCase(),
      eventDescription,
      status: 'draft'
    });

    await event.save();

    res.status(201).json({
      success: true,
      message: 'Event created successfully as draft',
      data: { event }
    });

  } catch (error) {
    console.error('Create event error:', error);

    // Clean up uploaded file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: messages
      });
    }

    res.status(500).json({
      success: false,
      message: 'An error occurred while creating the event',
      error: error.message
    });
  }
};

/**
 * Get all events for the authenticated event manager
 * GET /api/event-managers/events
 */
exports.getMyEvents = async (req, res) => {
  try {
    const eventManager = await EventManager.findOne({ userId: req.user._id });

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const { status, page = 1, limit = 10 } = req.query;
    const query = { eventManagerId: eventManager._id };

    // Filter by status if provided
    if (status) {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const events = await Event.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const eventsWithSalesPerformance = events.map((event) => {
      const eventObj = event.toObject();
      const totalTickets = Number(event.maximumNumberOfTickets || 0);
      const ticketSold = Number(event.ticketsSold || 0);
      const ticketPrice = Number(event.ticketPrice || 0);
      const earned = ticketSold * ticketPrice;
      const soldPerformancePercent = totalTickets > 0
        ? Number(((ticketSold / totalTickets) * 100).toFixed(2))
        : 0;

      return {
        ...eventObj,
        salesPerformance: {
          sold: `${ticketSold}/${totalTickets}`,
          ticketSold,
          totalTickets,
          earned,
          soldPerformancePercent
        }
      };
    });

    const totalEvents = await Event.countDocuments(query);

    res.status(200).json({
      success: true,
      data: {
        events: eventsWithSalesPerformance,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalEvents / parseInt(limit)),
          totalEvents,
          eventsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    console.error('Get my events error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching events',
      error: error.message
    });
  }
};

/**
 * Get a single event by ID
 * GET /api/event-managers/events/:id
 */
exports.getEventById = async (req, res) => {
  try {
    const eventManager = await EventManager.findOne({ userId: req.user._id });

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const event = await Event.findOne({
      _id: req.params.id,
      eventManagerId: eventManager._id
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    res.status(200).json({
      success: true,
      data: { event }
    });

  } catch (error) {
    console.error('Get event by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching the event',
      error: error.message
    });
  }
};

/**
 * Update an event
 * PUT /api/event-managers/events/:id
 */
exports.updateEvent = async (req, res) => {
  try {
    const eventManager = await EventManager.findOne({ userId: req.user._id });

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const event = await Event.findOne({
      _id: req.params.id,
      eventManagerId: eventManager._id
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Prevent editing published events that have already sold tickets
    if (event.status === 'published' && event.ticketsSold > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot edit an event that has already sold tickets. Please cancel and create a new event instead.'
      });
    }

    // Prevent editing cancelled or completed events
    if (event.status === 'cancelled' || event.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: `Cannot edit a ${event.status} event`
      });
    }

    const {
      eventName,
      eventType,
      eventManagerName,
      eventLocation,
      ticketSalesStartDate,
      ticketSalesEndDate,
      eventStartDateTime,
      eventEndDateTime,
      ticketPrice,
      maximumNumberOfTickets,
      confirmationCodePrefix,
      eventDescription
    } = req.body;

    // Handle event image upload if provided
    if (req.file) {
      try {
        const uploadResult = await uploadToCloudinary(req.file.path, 'events');

        if (uploadResult.success) {
          // Delete old event image from Cloudinary if exists
          if (event.eventImage) {
            const urlParts = event.eventImage.split('/');
            const publicIdWithExtension = urlParts.slice(-2).join('/');
            const publicId = publicIdWithExtension.split('.')[0];
            await deleteFromCloudinary(publicId);
          }

          event.eventImage = uploadResult.url;
        }

        // Delete local file after upload
        await fs.unlink(req.file.path).catch(() => {});
      } catch (uploadError) {
        console.error('Event image upload error:', uploadError);
      }
    }

    // Update event fields
    if (eventName) event.eventName = eventName;
    if (eventType) event.eventType = eventType;
    if (eventManagerName) event.eventManagerName = eventManagerName;
    if (eventLocation) event.eventLocation = eventLocation;
    if (ticketSalesStartDate) event.ticketSalesStartDate = new Date(ticketSalesStartDate);
    if (ticketSalesEndDate) event.ticketSalesEndDate = new Date(ticketSalesEndDate);
    if (eventStartDateTime) event.eventStartDateTime = new Date(eventStartDateTime);
    if (eventEndDateTime) event.eventEndDateTime = new Date(eventEndDateTime);
    if (ticketPrice !== undefined) event.ticketPrice = parseFloat(ticketPrice);
    if (maximumNumberOfTickets) {
      const newMax = parseInt(maximumNumberOfTickets);
      // Ensure new maximum is not less than tickets already sold
      if (newMax < event.ticketsSold) {
        return res.status(400).json({
          success: false,
          message: `Maximum number of tickets cannot be less than tickets already sold (${event.ticketsSold})`
        });
      }
      event.maximumNumberOfTickets = newMax;
    }
    if (confirmationCodePrefix) event.confirmationCodePrefix = confirmationCodePrefix.toUpperCase();
    if (eventDescription) event.eventDescription = eventDescription;

    await event.save();

    res.status(200).json({
      success: true,
      message: 'Event updated successfully',
      data: { event }
    });

  } catch (error) {
    console.error('Update event error:', error);

    // Clean up uploaded file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(err => err.message);
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: messages
      });
    }

    res.status(500).json({
      success: false,
      message: 'An error occurred while updating the event',
      error: error.message
    });
  }
};

/**
 * Publish an event
 * PUT /api/event-managers/events/:id/publish
 */
exports.publishEvent = async (req, res) => {
  try {
    const eventManager = await EventManager.findOne({ userId: req.user._id });

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const event = await Event.findOne({
      _id: req.params.id,
      eventManagerId: eventManager._id
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Only draft events can be published
    if (event.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: `Cannot publish a ${event.status} event`
      });
    }

    // Validate that the event is ready to be published
    if (!event.eventImage) {
      return res.status(400).json({
        success: false,
        message: 'Event image is required before publishing'
      });
    }

    // Check if ticket sales start date is in the future or very close
    const now = new Date();
    if (event.ticketSalesStartDate < now) {
      return res.status(400).json({
        success: false,
        message: 'Ticket sales start date must be in the future'
      });
    }

    await event.publish();

    res.status(200).json({
      success: true,
      message: 'Event published successfully',
      data: { event }
    });

  } catch (error) {
    console.error('Publish event error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while publishing the event',
      error: error.message
    });
  }
};

/**
 * Cancel an event
 * PUT /api/event-managers/events/:id/cancel
 */
exports.cancelEvent = async (req, res) => {
  try {
    const { cancellationReason } = req.body;

    if (!cancellationReason) {
      return res.status(400).json({
        success: false,
        message: 'Cancellation reason is required'
      });
    }

    const eventManager = await EventManager.findOne({ userId: req.user._id });

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const event = await Event.findOne({
      _id: req.params.id,
      eventManagerId: eventManager._id
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Can only cancel draft or published events
    if (event.status === 'cancelled') {
      return res.status(400).json({
        success: false,
        message: 'Event is already cancelled'
      });
    }

    if (event.status === 'completed') {
      return res.status(400).json({
        success: false,
        message: 'Cannot cancel a completed event'
      });
    }

    await event.cancel(cancellationReason);

    res.status(200).json({
      success: true,
      message: 'Event cancelled successfully',
      data: { event }
    });

  } catch (error) {
    console.error('Cancel event error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while cancelling the event',
      error: error.message
    });
  }
};

/**
 * Delete an event (only drafts with no tickets sold)
 * DELETE /api/event-managers/events/:id
 */
exports.deleteEvent = async (req, res) => {
  try {
    const eventManager = await EventManager.findOne({ userId: req.user._id });

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const event = await Event.findOne({
      _id: req.params.id,
      eventManagerId: eventManager._id
    });

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    // Only allow deleting draft events with no tickets sold
    if (event.status !== 'draft') {
      return res.status(400).json({
        success: false,
        message: 'Only draft events can be deleted. Please cancel the event instead.'
      });
    }

    if (event.ticketsSold > 0) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete an event with sold tickets'
      });
    }

    // Delete event image from Cloudinary if exists
    if (event.eventImage) {
      try {
        const urlParts = event.eventImage.split('/');
        const publicIdWithExtension = urlParts.slice(-2).join('/');
        const publicId = publicIdWithExtension.split('.')[0];
        await deleteFromCloudinary(publicId);
      } catch (deleteError) {
        console.error('Error deleting event image:', deleteError);
      }
    }

    await Event.deleteOne({ _id: event._id });

    res.status(200).json({
      success: true,
      message: 'Event deleted successfully'
    });

  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while deleting the event',
      error: error.message
    });
  }
};

/**
 * Get event statistics for the event manager
 * GET /api/event-managers/events/stats
 */
exports.getEventStats = async (req, res) => {
  try {
    const eventManager = await EventManager.findOne({ userId: req.user._id });

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const totalEvents = await Event.countDocuments({ eventManagerId: eventManager._id });
    const draftEvents = await Event.countDocuments({ eventManagerId: eventManager._id, status: 'draft' });
    const publishedEvents = await Event.countDocuments({ eventManagerId: eventManager._id, status: 'published' });
    const completedEvents = await Event.countDocuments({ eventManagerId: eventManager._id, status: 'completed' });
    const cancelledEvents = await Event.countDocuments({ eventManagerId: eventManager._id, status: 'cancelled' });

    // Get total tickets sold across all events
    const ticketStats = await Event.aggregate([
      { $match: { eventManagerId: eventManager._id } },
      {
        $group: {
          _id: null,
          totalTicketsSold: { $sum: '$ticketsSold' },
          totalRevenue: { $sum: { $multiply: ['$ticketsSold', '$ticketPrice'] } }
        }
      }
    ]);

    const stats = {
      totalEvents,
      draftEvents,
      publishedEvents,
      completedEvents,
      cancelledEvents,
      totalTicketsSold: ticketStats[0]?.totalTicketsSold || 0,
      totalRevenue: ticketStats[0]?.totalRevenue || 0
    };

    res.status(200).json({
      success: true,
      data: { stats }
    });

  } catch (error) {
    console.error('Get event stats error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching event statistics',
      error: error.message
    });
  }
};

/**
 * Get sales overview for the event manager
 * GET /api/event-managers/events/sales-overview
 * @query period - monthly | all_time (default: monthly)
 * @query month - 1..12 (monthly only, must be used with year)
 * @query year - 4-digit year (monthly only, must be used with month)
 * @query monthOffset - 0 = current month, 1 = previous month, 2 = two months ago (monthly only, fallback)
 */
exports.getSalesOverview = async (req, res) => {
  try {
    const eventManager = await EventManager.findOne({ userId: req.user._id });

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const period = String(req.query.period || 'monthly').trim().toLowerCase();
    const rawMonthOffset = Number(req.query.monthOffset ?? 0);
    const monthOffset = Number.isFinite(rawMonthOffset) && rawMonthOffset >= 0
      ? Math.floor(rawMonthOffset)
      : 0;

    if (!['monthly', 'all_time'].includes(period)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid period. Use "monthly" or "all_time"'
      });
    }

    const now = new Date();
    const matchStage = {
      eventManagerId: eventManager._id,
      paymentStatus: 'completed'
    };

    let dateRange = null;
    let selectedMonthOffset = null;
    if (period === 'monthly') {
      const hasMonth = req.query.month !== undefined;
      const hasYear = req.query.year !== undefined;

      if (hasMonth !== hasYear) {
        return res.status(400).json({
          success: false,
          message: 'For monthly period, provide both "month" and "year" together'
        });
      }

      let startDate;
      let endDate;

      if (hasMonth && hasYear) {
        const month = Number(req.query.month);
        const year = Number(req.query.year);
        const isValidMonth = Number.isInteger(month) && month >= 1 && month <= 12;
        const isValidYear = Number.isInteger(year) && year >= 1970 && year <= 9999;

        if (!isValidMonth || !isValidYear) {
          return res.status(400).json({
            success: false,
            message: 'Invalid month/year. Use month=1..12 and a valid 4-digit year'
          });
        }

        startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
        endDate = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0));
      } else {
        selectedMonthOffset = monthOffset;
        startDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset, 1, 0, 0, 0, 0));
        endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthOffset + 1, 1, 0, 0, 0, 0));
      }

      dateRange = { startDate, endDate };
    }

    const pipeline = [
      { $match: matchStage },
      {
        $addFields: {
          paidDate: { $ifNull: ['$paidAt', '$createdAt'] }
        }
      }
    ];

    if (dateRange) {
      pipeline.push({
        $match: {
          paidDate: { $gte: dateRange.startDate, $lt: dateRange.endDate }
        }
      });
    }

    pipeline.push({
      $group: {
        _id: null,
        totalRevenue: { $sum: '$totalAmount' },
        totalTicketsSold: { $sum: '$quantity' },
        totalSalesCount: { $sum: 1 }
      }
    });

    const [sales] = await EventTicketPurchase.aggregate(pipeline);

    res.status(200).json({
      success: true,
      data: {
        period,
        monthOffset: period === 'monthly' ? selectedMonthOffset : null,
        month: period === 'monthly' ? (dateRange.startDate.getUTCMonth() + 1) : null,
        year: period === 'monthly' ? dateRange.startDate.getUTCFullYear() : null,
        range: period === 'monthly'
          ? {
              startDate: dateRange.startDate,
              endDate: dateRange.endDate
            }
          : null,
        overview: {
          totalRevenue: Number((sales?.totalRevenue || 0).toFixed(2)),
          totalTicketsSold: sales?.totalTicketsSold || 0,
          totalSalesCount: sales?.totalSalesCount || 0
        }
      }
    });

  } catch (error) {
    console.error('Get sales overview error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching sales overview',
      error: error.message
    });
  }
};

/**
 * Get attendees list for an event (event manager)
 * GET /api/event-managers/events/:id/attendees
 * @query page - Page number (default: 1)
 * @query limit - Items per page (default: 20)
 */
exports.getEventAttendees = async (req, res) => {
  try {
    const eventManager = await EventManager.findOne({ userId: req.user._id });

    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager profile not found'
      });
    }

    const { id } = req.params;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
    const skip = (page - 1) * limit;

    const event = await Event.findOne({
      _id: id,
      eventManagerId: eventManager._id
    }).select('_id eventName');

    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    const purchaseQuery = {
      eventId: event._id,
      eventManagerId: eventManager._id,
      paymentStatus: 'completed'
    };

    const [summary, totalAttendees, purchases] = await Promise.all([
      EventTicketPurchase.aggregate([
        { $match: purchaseQuery },
        {
          $group: {
            _id: null,
            totalBuyers: { $sum: 1 },
            totalTicketsSold: { $sum: '$quantity' }
          }
        }
      ]),
      EventTicketPurchase.countDocuments(purchaseQuery),
      EventTicketPurchase.find(purchaseQuery)
        .populate('userId', 'fullName email phoneNumber profilePicture')
        .sort({ paidAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
    ]);

    const attendees = purchases.map((purchase) => {
      const buyer = purchase.userId || {};
      const primaryOwner = Array.isArray(purchase.ticketOwners) && purchase.ticketOwners.length > 0
        ? purchase.ticketOwners[0]
        : null;

      return {
        purchaseId: purchase._id,
        buyer: {
          userId: buyer._id || null,
          name: buyer.fullName || primaryOwner?.name || 'Unknown Buyer',
          email: buyer.email || null,
          phoneNumber: buyer.phoneNumber || null,
          profilePicture: buyer.profilePicture || null
        },
        ticketsPurchased: purchase.quantity,
        receiptNumber: purchase.paymentIntentId || purchase.checkoutSessionId || String(purchase._id),
        idNumber: primaryOwner?.identificationNumber || null,
        idType: primaryOwner?.identificationType || null,
        paidAt: purchase.paidAt || purchase.createdAt,
        ticketOwners: purchase.ticketOwners || []
      };
    });

    res.status(200).json({
      success: true,
      data: {
        event: {
          id: event._id,
          eventName: event.eventName
        },
        summary: {
          totalBuyers: summary[0]?.totalBuyers || 0,
          totalTicketsSold: summary[0]?.totalTicketsSold || 0
        },
        attendees,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalAttendees / limit),
          totalAttendees,
          attendeesPerPage: limit
        }
      }
    });

  } catch (error) {
    console.error('Get event attendees error:', error);
    res.status(500).json({
      success: false,
      message: 'An error occurred while fetching event attendees',
      error: error.message
    });
  }
};
