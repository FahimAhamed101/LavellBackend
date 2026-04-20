const Event = require('../models/Event');
const EventManager = require('../models/EventManager');
const EventTicketPurchase = require('../models/EventTicketPurchase');
const { getStripe } = require('../utility/stripe');

/**
 * Buy event tickets (user)
 * POST /api/events/:id/buy-tickets
 * body: { quantity, ticketOwners: [{ name, identificationType, identificationNumber }] }
 */
exports.buyTickets = async (req, res) => {
  try {
    const { id } = req.params;
    const { quantity, ticketOwners } = req.body;
    const userId = req.user._id;
    const parsedQuantity = Number(quantity);

    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 10) {
      return res.status(400).json({
        success: false,
        message: 'quantity must be between 1 and 10'
      });
    }

    if (!Array.isArray(ticketOwners) || ticketOwners.length !== parsedQuantity) {
      return res.status(400).json({
        success: false,
        message: 'ticketOwners length must match quantity'
      });
    }

    const event = await Event.findById(id);
    if (!event) {
      return res.status(404).json({
        success: false,
        message: 'Event not found'
      });
    }

    if (event.status !== 'published') {
      return res.status(400).json({
        success: false,
        message: 'Event is not published'
      });
    }

    const now = new Date();
    if (event.ticketSalesStartDate && now < event.ticketSalesStartDate) {
      return res.status(400).json({
        success: false,
        message: 'Ticket sales have not started yet'
      });
    }

    if (event.ticketSalesEndDate && now > event.ticketSalesEndDate) {
      return res.status(400).json({
        success: false,
        message: 'Ticket sales have ended for this event'
      });
    }

    if (event.eventEndDateTime && now > event.eventEndDateTime) {
      return res.status(400).json({
        success: false,
        message: 'This event has already ended'
      });
    }

    const [completedAgg, pendingAgg] = await Promise.all([
      EventTicketPurchase.aggregate([
        {
          $match: {
            eventId: event._id,
            paymentStatus: 'completed'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$quantity' }
          }
        }
      ]),
      EventTicketPurchase.aggregate([
        {
          $match: {
            eventId: event._id,
            paymentStatus: 'pending'
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$quantity' }
          }
        }
      ])
    ]);

    const soldFromPurchases = completedAgg[0]?.total || 0;
    const pendingReserved = pendingAgg[0]?.total || 0;
    const soldTickets = Math.max(event.ticketsSold || 0, soldFromPurchases);
    const remainingTickets = Math.max(
      (event.maximumNumberOfTickets || 0) - soldTickets - pendingReserved,
      0
    );

    if (remainingTickets < parsedQuantity) {
      return res.status(400).json({
        success: false,
        message:
          remainingTickets > 0
            ? `Only ${remainingTickets} ticket(s) left for this event`
            : 'Event is sold out'
      });
    }

    const eventManager = await EventManager.findById(event.eventManagerId);
    if (!eventManager) {
      return res.status(404).json({
        success: false,
        message: 'Event manager not found'
      });
    }

    const ticketPrice = event.ticketPrice;
    const totalAmount = Math.round(ticketPrice * parsedQuantity * 100) / 100;
    const platformFee = Math.round(totalAmount * 0.1 * 100) / 100;
    const eventManagerPayout = Math.max(totalAmount - platformFee, 0);

    const purchase = await EventTicketPurchase.create({
      userId,
      eventId: event._id,
      eventManagerId: eventManager._id,
      quantity: parsedQuantity,
      ticketOwners,
      ticketPrice,
      totalAmount,
      platformFee,
      eventManagerPayout
    });

    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(totalAmount * 100),
      currency: 'usd',
      metadata: {
        eventTicketPurchaseId: purchase._id.toString(),
        eventId: event._id.toString(),
        eventManagerId: eventManager._id.toString(),
        userId: userId.toString(),
        type: 'event_ticket_purchase'
      }
    });

    purchase.paymentIntentId = paymentIntent.id;
    purchase.paymentIntentStatus = paymentIntent.status;
    await purchase.save();

    return res.status(200).json({
      success: true,
      message: 'Payment intent created',
      data: {
        purchaseId: purchase._id,
        remainingTickets: remainingTickets - parsedQuantity,
        checkout: { clientSecret: paymentIntent.client_secret }
      }
    });
  } catch (error) {
    console.error('Buy tickets error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating ticket checkout',
      error: error.message
    });
  }
};

/**
 * Get my ticket purchases (user)
 * GET /api/events/my-tickets
 */
exports.getMyTicketPurchases = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20 } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;

    const [purchases, total] = await Promise.all([
      EventTicketPurchase.find({ userId })
        .populate('eventId', 'eventName eventImage eventLocation eventStartDateTime eventEndDateTime ticketPrice')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      EventTicketPurchase.countDocuments({ userId })
    ]);

    res.status(200).json({
      success: true,
      data: {
        purchases,
        total,
        currentPage: pageNum,
        totalPages: Math.ceil(total / limitNum)
      }
    });
  } catch (error) {
    console.error('Get my ticket purchases error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching ticket purchases',
      error: error.message
    });
  }
};

/**
 * Get ticket purchase by ID (user)
 * GET /api/events/tickets/:id
 */
exports.getTicketPurchaseById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const purchase = await EventTicketPurchase.findById(id)
      .populate('eventId', 'eventName eventImage eventLocation eventStartDateTime eventEndDateTime ticketPrice');

    if (!purchase) {
      return res.status(404).json({
        success: false,
        message: 'Ticket purchase not found'
      });
    }

    if (purchase.userId.toString() !== userId.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized'
      });
    }

    res.status(200).json({
      success: true,
      data: {
        purchase
      }
    });
  } catch (error) {
    console.error('Get ticket purchase by ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching ticket purchase',
      error: error.message
    });
  }
};
