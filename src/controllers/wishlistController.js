const Wishlist = require('../models/Wishlist');
const Service = require('../models/Service');
const Appointment = require('../models/Appointment');

// Get user's wishlist
exports.getWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.getOrCreateForUser(req.user._id);

    // Populate the items
    await wishlist.populate([
      {
        path: 'items.serviceId',
        select: 'headline description servicePhoto basePrice appointmentEnabled rating totalReviews category providerId',
        populate: [
          { path: 'category', select: 'name slug' },
          { path: 'providerId', select: 'userId', populate: { path: 'userId', select: 'fullName profilePicture' } }
        ]
      },
      {
        path: 'items.appointmentId',
        select: 'appointmentDate timeSlot selectedSlot totalAmount appointmentStatus serviceSnapshot providerId',
        populate: { path: 'providerId', select: 'userId', populate: { path: 'userId', select: 'fullName profilePicture' } }
      }
    ]);

    // Separate services and appointments
    const services = wishlist.items
      .filter(item => item.itemType === 'service' && item.serviceId)
      .map(item => ({
        _id: item._id,
        service: item.serviceId,
        addedAt: item.addedAt,
        notes: item.notes
      }));

    const appointments = wishlist.items
      .filter(item => item.itemType === 'appointment' && item.appointmentId)
      .map(item => ({
        _id: item._id,
        appointment: item.appointmentId,
        addedAt: item.addedAt,
        notes: item.notes
      }));

    res.status(200).json({
      success: true,
      message: 'Wishlist retrieved successfully',
      data: {
        services,
        appointments,
        totalItems: wishlist.items.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error retrieving wishlist',
      error: error.message
    });
  }
};



// Add service to wishlist
exports.addService = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { notes } = req.body;

    // Check if service exists and is active
    const service = await Service.findOne({ _id: serviceId, isActive: true });
    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found or is inactive'
      });
    }

    const wishlist = await Wishlist.getOrCreateForUser(req.user._id);

    await wishlist.addItem('service', serviceId, notes);

    res.status(200).json({
      success: true,
      message: 'Service added to wishlist successfully'
    });
  } catch (error) {
    if (error.message.includes('already in your wishlist')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error adding service to wishlist',
      error: error.message
    });
  }
};

// Remove service from wishlist
exports.removeService = async (req, res) => {
  try {
    const { serviceId } = req.params;

    const wishlist = await Wishlist.findOne({ userId: req.user._id });
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    await wishlist.removeItem('service', serviceId);

    res.status(200).json({
      success: true,
      message: 'Service removed from wishlist successfully'
    });
  } catch (error) {
    if (error.message.includes('not in your wishlist')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error removing service from wishlist',
      error: error.message
    });
  }
};

// Add appointment to wishlist
exports.addAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { notes } = req.body;

    // Check if appointment exists and belongs to user
    const appointment = await Appointment.findOne({
      _id: appointmentId,
      userId: req.user._id
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: 'Appointment not found or does not belong to you'
      });
    }

    const wishlist = await Wishlist.getOrCreateForUser(req.user._id);

    await wishlist.addItem('appointment', appointmentId, notes);

    res.status(200).json({
      success: true,
      message: 'Appointment added to wishlist successfully'
    });
  } catch (error) {
    if (error.message.includes('already in your wishlist')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error adding appointment to wishlist',
      error: error.message
    });
  }
};

// Remove appointment from wishlist
exports.removeAppointment = async (req, res) => {
  try {
    const { appointmentId } = req.params;

    const wishlist = await Wishlist.findOne({ userId: req.user._id });
    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    await wishlist.removeItem('appointment', appointmentId);

    res.status(200).json({
      success: true,
      message: 'Appointment removed from wishlist successfully'
    });
  } catch (error) {
    if (error.message.includes('not in your wishlist')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    res.status(500).json({
      success: false,
      message: 'Error removing appointment from wishlist',
      error: error.message
    });
  }
};

// Check if item is in wishlist
exports.checkItem = async (req, res) => {
  try {
    const { itemType, itemId } = req.params;

    if (!['service', 'appointment'].includes(itemType)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid item type. Must be "service" or "appointment"'
      });
    }

    const wishlist = await Wishlist.findOne({ userId: req.user._id });

    const isInWishlist = wishlist ? wishlist.hasItem(itemType, itemId) : false;

    res.status(200).json({
      success: true,
      data: {
        isInWishlist
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error checking wishlist item',
      error: error.message
    });
  }
};

// Clear all items from wishlist
exports.clearWishlist = async (req, res) => {
  try {
    const wishlist = await Wishlist.findOne({ userId: req.user._id });

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    wishlist.items = [];
    await wishlist.save();

    res.status(200).json({
      success: true,
      message: 'Wishlist cleared successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error clearing wishlist',
      error: error.message
    });
  }
};

// Update notes for a wishlist item
exports.updateNotes = async (req, res) => {
  try {
    const { itemId } = req.params;
    const { notes } = req.body;

    const wishlist = await Wishlist.findOne({ userId: req.user._id });

    if (!wishlist) {
      return res.status(404).json({
        success: false,
        message: 'Wishlist not found'
      });
    }

    const item = wishlist.items.id(itemId);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: 'Item not found in wishlist'
      });
    }

    item.notes = notes || '';
    await wishlist.save();

    res.status(200).json({
      success: true,
      message: 'Notes updated successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error updating notes',
      error: error.message
    });
  }
};
